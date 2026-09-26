from __future__ import annotations

import json
import logging
import re
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.parse import urljoin

import pymysql
from airflow.decorators import dag, task
from airflow.hooks.base import BaseHook
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)


# ===== models.py =====
@dataclass
class PropertyRecord:
    imobiliaria: str
    siteImobiliaria: str
    codigoImovel: Optional[str]
    urlAnuncio: str
    cidade: Optional[str]
    bairro: Optional[str]
    tipoImovel: Optional[str]
    valorAnunciado: Optional[float]
    areaConstruida: Optional[float]
    areaTerreno: Optional[float]
    quartos: Optional[int]
    banheiros: Optional[int]
    suites: Optional[int]
    vagasGaragem: Optional[int]
    possuiPiscina: Optional[bool]
    estadoConservacao: Optional[str]
    padraoAcabamento: Optional[str]
    descricao: Optional[str]
    imagemPrincipal: Optional[str]
    imagens: list[str]
    dataPrimeiraColeta: Optional[datetime]
    dataUltimaColeta: datetime
    ativo: bool = True
    finalidade: Optional[str] = None

    @property
    def property_key(self) -> str:
        identity = self.codigoImovel or self.urlAnuncio
        finalidade = (self.finalidade or "").upper()
        return f"{self.imobiliaria}|{finalidade}|{identity}"

    def to_dict(self) -> dict:
        result = asdict(self)
        result["propertyKey"] = self.property_key
        return result


@dataclass
class ImageRecord:
    propertyKey: str
    imobiliaria: str
    finalidade: str
    codigoImovel: Optional[str]
    urlAnuncio: str
    urlImagem: str
    imagemPrincipal: bool
    ordem: int
    dataPrimeiraColeta: Optional[datetime]
    dataUltimaColeta: datetime
    ativo: bool = True


# ===== parser.py =====
IMOBILIARIA = "Imobiliaria Parana"
SITE = "https://www.imobiliariaparana.com"


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def ascii_upper(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(c for c in normalized if not unicodedata.combining(c)).upper()


def parse_brl(value: str | None) -> float | None:
    if not value:
        return None
    m = re.search(r"R\$\s*([\d.]+(?:,\d{1,2})?)", value)
    if not m:
        return None
    raw = m.group(1).replace(".", "").replace(",", ".")
    try:
        return float(Decimal(raw))
    except InvalidOperation:
        return None


def parse_number(value: str | None) -> float | None:
    if not value:
        return None
    m = re.search(r"(\d+(?:[.,]\d+)?)", value)
    if not m:
        return None
    raw = m.group(1).replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    n = parse_number(value)
    return int(n) if n is not None else None


def infer_property_type(*texts: str | None) -> str | None:
    text = ascii_upper(" ".join(t for t in texts if t))
    if re.search(r"\b(APARTAMENTO|APTO)\b", text):
        return "APARTAMENTO"
    if re.search(r"\b(TERRENO|LOTE)\b", text):
        return "TERRENO"
    if re.search(r"\b(CASA|SOBRADO|RESIDENCIA|RESIDENCIAL)\b", text):
        return "CASA"
    return None


def infer_condition(description: str | None) -> str | None:
    text = ascii_upper(description)
    rules = [
        (r"\bNOV[OA]\b|RECEM[- ]CONSTRUID", "NOVO"),
        (r"REFORMAD", "REFORMADO"),
        (r"BOM ESTADO|BEM CONSERVAD", "BOM"),
        (r"PRECISA.*REFORMA|PARA REFORMAR", "A REFORMAR"),
    ]
    for pattern, label in rules:
        if re.search(pattern, text):
            return label
    return None


def infer_finish(description: str | None) -> str | None:
    text = ascii_upper(description)
    if re.search(r"ALTO PADRAO|ACABAMENTO FINO|FINO ACABAMENTO", text):
        return "ALTO PADRAO"
    if re.search(r"MEDIO PADRAO|PADRAO MEDIO", text):
        return "MEDIO PADRAO"
    if re.search(r"PADRAO SIMPLES|ACABAMENTO SIMPLES", text):
        return "SIMPLES"
    return None


def _extract_jsonld_images(soup: BeautifulSoup, base_url: str) -> list[str]:
    urls: list[str] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.get_text(strip=True))
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            imgs = node.get("image")
            if isinstance(imgs, str):
                imgs = [imgs]
            if isinstance(imgs, list):
                urls.extend(urljoin(base_url, x) for x in imgs if isinstance(x, str))
    return urls


def extract_images(soup: BeautifulSoup, base_url: str) -> list[str]:
    candidates = _extract_jsonld_images(soup, base_url)
    for img in soup.find_all("img"):
        for attr in ("data-src", "data-lazy", "data-original", "src"):
            raw = img.get(attr)
            if not raw or raw.startswith("data:"):
                continue
            u = urljoin(base_url, raw)
            low = u.lower()
            if any(x in low for x in ("logo", "icone", "icon", "avatar", "facebook", "instagram", "youtube")):
                continue
            # Prioriza imagens que parecem pertencer ao modulo de imoveis/galeria.
            parent_text = ascii_upper(" ".join(img.parent.stripped_strings) if img.parent else "")
            classes = " ".join(img.get("class", []))
            marker = f"{low} {classes.lower()} {parent_text.lower()}"
            if any(x in marker for x in ("imovel", "galeria", "gallery", "foto", "fotos", "upload")):
                candidates.append(u)
    seen: set[str] = set()
    out: list[str] = []
    for u in candidates:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _heading_value_pairs(soup: BeautifulSoup) -> dict[str, str]:
    """Extrai pares label/valor de blocos visuais sem depender de uma classe CSS unica."""
    pairs: dict[str, str] = {}
    labels = {
        "AREA DO TERRENO", "AREA PRIVATIVA", "AREA COMUM", "AREA CONSTRUIDA",
        "QUARTOS", "QUARTO", "BANHEIRO", "BANHEIROS", "SUITE", "SUITES",
        "GARAGEM", "GARAGENS", "PISCINA",
    }
    elements = soup.find_all(["div", "span", "p", "li", "strong", "h3", "h4", "h5", "h6"])
    for el in elements:
        label = ascii_upper(clean_text(el.get_text(" ", strip=True)))
        if label not in labels:
            continue
        # Procura primeiro um irmao proximo; depois o pai inteiro.
        value = None
        sib = el.find_next_sibling()
        if sib:
            value = clean_text(sib.get_text(" ", strip=True))
        if not value and el.parent:
            parent_text = clean_text(el.parent.get_text(" ", strip=True)) or ""
            value = clean_text(parent_text.replace(el.get_text(" ", strip=True), "", 1))
        if value:
            pairs[label] = value
    return pairs


def _regex_pairs(page_text: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    patterns = {
        "AREA DO TERRENO": r"Área do Terreno\s*([\d.,]+)\s*m²",
        "AREA PRIVATIVA": r"Área Privativa\s*([\d.,]+)\s*m²",
        "AREA COMUM": r"Área Comum\s*([\d.,]+)\s*m²",
        "AREA CONSTRUIDA": r"Área Constru[ií]da\s*([\d.,]+)\s*m²",
        "QUARTOS": r"QUARTOS?\s*(\d+)",
        "BANHEIRO": r"BANHEIROS?\s*(\d+)",
        "SUITE": r"SU[IÍ]TES?\s*(\d+)",
        "GARAGEM": r"GARAGENS?\s*(\d+)",
        "PISCINA": r"PISCINA\s*(\d+)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, page_text, flags=re.I)
        if m:
            pairs[key] = m.group(1)
    return pairs


def _pick(pairs: dict[str, str], *keys: str) -> str | None:
    for k in keys:
        if k in pairs:
            return pairs[k]
    return None


def _extract_description(soup: BeautifulSoup) -> str | None:
    heading = soup.find(lambda tag: tag.name in ["h2", "h3", "h4"] and "descricao do imovel" in ascii_upper(tag.get_text(" ", strip=True)).lower())
    if heading:
        chunks: list[str] = []
        for node in heading.find_all_next():
            if node.name in ["h1", "h2", "h3"] and node is not heading:
                title = ascii_upper(node.get_text(" ", strip=True))
                if any(x in title for x in ("ENTRE EM CONTATO", "IMOBILIARIA PARANA")):
                    break
            if node.name in ["p", "li", "h2", "h3", "h4"]:
                txt = clean_text(node.get_text(" ", strip=True))
                if txt and ascii_upper(txt) != "DESCRICAO DO IMOVEL":
                    chunks.append(txt)
        if chunks:
            return clean_text("\n".join(dict.fromkeys(chunks)))
    return None


def _extract_address_parts(soup: BeautifulSoup) -> tuple[str | None, str | None]:
    page_text = clean_text(soup.get_text(" ", strip=True)) or ""
    # Formato observado: rua - Bairro - PALOTINA - PR
    m = re.search(r"Endere[cç]o\s+(.+?)\s+-\s+([^\-]+?)\s+-\s+([A-ZÁÉÍÓÚÃÕÇ ]+?)\s+-\s+PR\b", page_text, re.I)
    if m:
        bairro = clean_text(m.group(2))
        cidade = clean_text(m.group(3))
        return cidade.title() if cidade else None, bairro
    m = re.search(r"\b(PALOTINA)\s*-\s*PR\b", page_text, re.I)
    return (m.group(1).title() if m else None), None


def parse_property(html: str, url: str, finalidade: str, collected_at: datetime) -> PropertyRecord:
    soup = BeautifulSoup(html, "html.parser")
    page_text = clean_text(soup.get_text(" ", strip=True)) or ""

    code_match = re.search(r"\bCOD\s*:\s*([A-Za-z0-9_-]+)", page_text, re.I)
    code = code_match.group(1).strip() if code_match else None

    value_match = re.search(r"Valor de (?:Venda|Loca[cç][aã]o).*?(R\$\s*[\d.,]+)", page_text, re.I)
    valor = parse_brl(value_match.group(1) if value_match else None)

    h1h2 = soup.find(["h1", "h2"])
    title = clean_text(h1h2.get_text(" ", strip=True)) if h1h2 else None
    description = _extract_description(soup)

    pairs = _regex_pairs(page_text)
    pairs.update({k: v for k, v in _heading_value_pairs(soup).items() if k not in pairs})

    area_terreno = parse_number(_pick(pairs, "AREA DO TERRENO"))
    area_construida = parse_number(_pick(pairs, "AREA CONSTRUIDA", "AREA PRIVATIVA", "AREA COMUM"))
    quartos = parse_int(_pick(pairs, "QUARTOS", "QUARTO"))
    banheiros = parse_int(_pick(pairs, "BANHEIRO", "BANHEIROS"))
    suites = parse_int(_pick(pairs, "SUITE", "SUITES"))
    garagem = parse_int(_pick(pairs, "GARAGEM", "GARAGENS"))

    pool_value = parse_int(_pick(pairs, "PISCINA"))
    if pool_value is not None:
        possui_piscina = pool_value > 0
    else:
        desc_ascii = ascii_upper(description)
        if "SEM PISCINA" in desc_ascii or "ESPACO PARA INSTALACAO DE PISCINA" in desc_ascii:
            possui_piscina = False
        elif re.search(r"\b(COM|POSSUI|TEM)\s+(UMA\s+)?PISCINA\b", desc_ascii):
            possui_piscina = True
        else:
            possui_piscina = None

    cidade, bairro = _extract_address_parts(soup)
    images = extract_images(soup, url)
    tipo = infer_property_type(title, url, description)

    return PropertyRecord(
        imobiliaria=IMOBILIARIA,
        siteImobiliaria=SITE,
        codigoImovel=code,
        urlAnuncio=url,
        cidade=cidade,
        bairro=bairro,
        tipoImovel=tipo,
        valorAnunciado=valor,
        areaConstruida=area_construida,
        areaTerreno=area_terreno,
        quartos=quartos,
        banheiros=banheiros,
        suites=suites,
        vagasGaragem=garagem,
        possuiPiscina=possui_piscina,
        estadoConservacao=infer_condition(description),
        padraoAcabamento=infer_finish(description),
        descricao=description,
        imagemPrincipal=images[0] if images else None,
        imagens=images,
        dataPrimeiraColeta=None,
        dataUltimaColeta=collected_at,
        ativo=True,
        finalidade=finalidade.upper(),
    )


def to_image_records(record: PropertyRecord) -> list[ImageRecord]:
    return [
        ImageRecord(
            propertyKey=record.property_key,
            imobiliaria=record.imobiliaria,
            finalidade=(record.finalidade or "").upper(),
            codigoImovel=record.codigoImovel,
            urlAnuncio=record.urlAnuncio,
            urlImagem=url,
            imagemPrincipal=(idx == 0),
            ordem=idx + 1,
            dataPrimeiraColeta=None,
            dataUltimaColeta=record.dataUltimaColeta,
            ativo=True,
        )
        for idx, url in enumerate(record.imagens)
    ]


# ===== scraper.py =====
import random
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


log = logging.getLogger(__name__)

BASE_URL = "https://www.imobiliariaparana.com"
LIST_URLS = {
    "VENDA": f"{BASE_URL}/venda",
    "LOCACAO": f"{BASE_URL}/locacao",
}


class ImobiliariaParanaScraper:
    def __init__(
        self,
        headless: bool = True,
        timeout_ms: int = 45_000,
        delay_range: tuple[float, float] = (0.4, 1.0),
    ) -> None:
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.delay_range = delay_range

    def _polite_delay(self) -> None:
        time.sleep(random.uniform(*self.delay_range))

    def discover_links(self, finalidade: str) -> list[str]:
        finalidade = finalidade.upper()
        list_url = LIST_URLS[finalidade]
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page(
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "Chrome/126 Safari/537.36"
                )
            )
            page.set_default_timeout(self.timeout_ms)
            page.goto(list_url, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=10_000)
            except PlaywrightTimeoutError:
                pass

            unchanged_rounds = 0
            previous_count = -1
            for _ in range(200):
                hrefs = page.locator("a[href*='/imovel/']").evaluate_all(
                    "els => els.map(e => e.href).filter(Boolean)"
                )
                current_count = len(set(hrefs))
                if current_count == previous_count:
                    unchanged_rounds += 1
                else:
                    unchanged_rounds = 0
                previous_count = current_count

                buttons = page.get_by_text("Carregar Mais", exact=False)
                if buttons.count() == 0 or unchanged_rounds >= 2:
                    break
                btn = buttons.last
                if not btn.is_visible() or not btn.is_enabled():
                    break
                try:
                    btn.click()
                    page.wait_for_timeout(900)
                except Exception:
                    break

            hrefs = page.locator("a[href*='/imovel/']").evaluate_all(
                "els => els.map(e => e.href).filter(Boolean)"
            )
            browser.close()

        expected_prefix = "/venda/imovel/" if finalidade == "VENDA" else "/locacao/imovel/"
        links: list[str] = []
        seen = set()
        for href in hrefs:
            absolute = urljoin(BASE_URL, href)
            parsed = urlparse(absolute)
            if parsed.netloc not in {"www.imobiliariaparana.com", "imobiliariaparana.com"}:
                continue
            if expected_prefix not in parsed.path:
                continue
            normalized = f"https://www.imobiliariaparana.com{parsed.path.rstrip('/')}"
            if normalized not in seen:
                seen.add(normalized)
                links.append(normalized)
        log.info("%s: %d links descobertos", finalidade, len(links))
        return links

    def scrape_detail(self, url: str, finalidade: str, collected_at: datetime) -> PropertyRecord:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            page.set_default_timeout(self.timeout_ms)
            page.goto(url, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=8_000)
            except PlaywrightTimeoutError:
                pass
            # Dispara lazy-loading de imagens da galeria.
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(300)
            html = page.content()
            browser.close()
        self._polite_delay()
        return parse_property(html, url, finalidade, collected_at)

    def scrape(self, finalidade: str, allowed_types: set[str] | None = None) -> tuple[list[PropertyRecord], list[dict]]:
        collected_at = datetime.now(timezone.utc)
        records: list[PropertyRecord] = []
        errors: list[dict] = []
        links = self.discover_links(finalidade)
        for i, url in enumerate(links, start=1):
            try:
                record = self.scrape_detail(url, finalidade, collected_at)
                if allowed_types and record.tipoImovel not in allowed_types:
                    log.info("Ignorado por tipo (%s): %s", record.tipoImovel, url)
                    continue
                records.append(record)
                log.info("Coletado %d/%d: %s", i, len(links), record.property_key)
            except Exception as exc:
                log.exception("Erro no anuncio %s", url)
                errors.append({"url": url, "erro": repr(exc)})
        return records, errors


# ===== repository.py =====
log = logging.getLogger(__name__)


class DestinationRepository(ABC):
    @abstractmethod
    def upsert_property(self, record: PropertyRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def upsert_images(self, images: list[ImageRecord]) -> None:
        raise NotImplementedError

    @abstractmethod
    def mark_missing_as_inactive(
        self,
        imobiliaria: str,
        finalidade: str,
        seen_property_keys: set[str],
        collected_at: datetime,
    ) -> None:
        raise NotImplementedError


class MySQLRepository(DestinationRepository):
    """Persistencia no MySQL/MariaDB configurado por uma Connection do Airflow.

    VENDA e LOCACAO sao segregados pela coluna ``finalidade`` da tabela de imoveis.
    """

    def __init__(
        self,
        conn_id: str = "ProjetoIntegrador",
        database: str = "moravdb",
        properties_table: str = "imoveis",
        images_table: str = "imovel_imagens",
    ) -> None:
        self.conn_id = conn_id
        self.database = database
        self.properties_table = properties_table
        self.images_table = images_table

    @staticmethod
    def _mysql_datetime(value: datetime) -> datetime:
        """MySQL DATETIME nao guarda timezone; persistimos sempre UTC sem tzinfo."""
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def _connect(self) -> pymysql.connections.Connection:
        airflow_conn = BaseHook.get_connection(self.conn_id)
        extra = airflow_conn.extra_dejson or {}

        kwargs: dict[str, Any] = {
            "host": airflow_conn.host,
            "user": airflow_conn.login,
            "password": airflow_conn.password,
            "database": self.database,
            "port": airflow_conn.port or 3306,
            "charset": "utf8mb4",
            "autocommit": False,
            "cursorclass": pymysql.cursors.DictCursor,
            "connect_timeout": int(extra.get("connect_timeout", 15)),
            "read_timeout": int(extra.get("read_timeout", 60)),
            "write_timeout": int(extra.get("write_timeout", 60)),
        }

        # Permite reaproveitar configuracao SSL da Connection, quando existir.
        ssl: dict[str, str] = {}
        if extra.get("ssl_ca"):
            ssl["ca"] = extra["ssl_ca"]
        if extra.get("ssl_cert"):
            ssl["cert"] = extra["ssl_cert"]
        if extra.get("ssl_key"):
            ssl["key"] = extra["ssl_key"]
        if ssl:
            kwargs["ssl"] = ssl

        return pymysql.connect(**kwargs)

    def _find_property_id(
        self,
        cursor: pymysql.cursors.DictCursor,
        imobiliaria: str,
        finalidade: str,
        codigo_imovel: str | None,
        url_anuncio: str,
    ) -> int | None:
        # O codigo e a chave primaria de negocio quando existe. A URL tambem entra
        # como fallback para absorver um registro que anteriormente veio sem codigo.
        if codigo_imovel:
            cursor.execute(
                f"""
                SELECT id
                  FROM `{self.properties_table}`
                 WHERE imobiliaria = %s
                   AND finalidade = %s
                   AND (codigo_imovel = %s OR url_anuncio = %s)
                 ORDER BY (codigo_imovel = %s) DESC
                 LIMIT 1
                """,
                (imobiliaria, finalidade, codigo_imovel, url_anuncio, codigo_imovel),
            )
        else:
            cursor.execute(
                f"""
                SELECT id
                  FROM `{self.properties_table}`
                 WHERE imobiliaria = %s
                   AND finalidade = %s
                   AND url_anuncio = %s
                 LIMIT 1
                """,
                (imobiliaria, finalidade, url_anuncio),
            )
        row = cursor.fetchone()
        return int(row["id"]) if row else None

    @staticmethod
    def _tipo_mysql(tipo: str | None) -> str:
        allowed = {"CASA", "APARTAMENTO", "TERRENO", "OUTRO"}
        normalized = (tipo or "OUTRO").upper()
        return normalized if normalized in allowed else "OUTRO"

    def upsert_property(self, record: PropertyRecord) -> None:
        collected_at = self._mysql_datetime(record.dataUltimaColeta)
        finalidade = (record.finalidade or "").upper()
        if not finalidade:
            raise ValueError("finalidade e obrigatoria para persistir o imovel")

        values = {
            "imobiliaria": record.imobiliaria,
            "finalidade": finalidade,
            "site_imobiliaria": record.siteImobiliaria,
            "codigo_imovel": record.codigoImovel,
            "url_anuncio": record.urlAnuncio,
            "cidade": record.cidade,
            "bairro": record.bairro,
            "tipo_imovel": self._tipo_mysql(record.tipoImovel),
            "valor_anunciado": record.valorAnunciado,
            "area_construida": record.areaConstruida,
            "area_terreno": record.areaTerreno,
            "quartos": record.quartos,
            "banheiros": record.banheiros,
            "suites": record.suites,
            "vagas_garagem": record.vagasGaragem,
            "possui_piscina": None if record.possuiPiscina is None else int(record.possuiPiscina),
            "estado_conservacao": record.estadoConservacao,
            "padrao_acabamento": record.padraoAcabamento,
            "descricao": record.descricao,
            "imagem_principal": record.imagemPrincipal,
        }

        conn = self._connect()
        try:
            with conn.cursor() as cursor:
                property_id = self._find_property_id(
                    cursor,
                    record.imobiliaria,
                    finalidade,
                    record.codigoImovel,
                    record.urlAnuncio,
                )

                if property_id is None:
                    cursor.execute(
                        f"""
                        INSERT INTO `{self.properties_table}` (
                            imobiliaria, site_imobiliaria, codigo_imovel, url_anuncio,
                            cidade, bairro, tipo_imovel, finalidade, valor_anunciado,
                            area_construida, area_terreno, quartos, banheiros, suites,
                            vagas_garagem, possui_piscina, estado_conservacao,
                            padrao_acabamento, descricao, imagem_principal,
                            data_primeira_coleta, data_ultima_coleta, ativo,
                            criado_em, atualizado_em
                        ) VALUES (
                            %(imobiliaria)s, %(site_imobiliaria)s, %(codigo_imovel)s, %(url_anuncio)s,
                            %(cidade)s, %(bairro)s, %(tipo_imovel)s, %(finalidade)s, %(valor_anunciado)s,
                            %(area_construida)s, %(area_terreno)s, %(quartos)s, %(banheiros)s, %(suites)s,
                            %(vagas_garagem)s, %(possui_piscina)s, %(estado_conservacao)s,
                            %(padrao_acabamento)s, %(descricao)s, %(imagem_principal)s,
                            %(collected_at)s, %(collected_at)s, 1,
                            %(collected_at)s, %(collected_at)s
                        )
                        """,
                        {**values, "collected_at": collected_at},
                    )
                    property_id = int(cursor.lastrowid)
                    log.info("Imovel inserido id=%s chave=%s", property_id, record.property_key)
                else:
                    cursor.execute(
                        f"""
                        UPDATE `{self.properties_table}`
                           SET site_imobiliaria = %(site_imobiliaria)s,
                               codigo_imovel = %(codigo_imovel)s,
                               url_anuncio = %(url_anuncio)s,
                               cidade = %(cidade)s,
                               bairro = %(bairro)s,
                               tipo_imovel = %(tipo_imovel)s,
                               finalidade = %(finalidade)s,
                               valor_anunciado = %(valor_anunciado)s,
                               area_construida = %(area_construida)s,
                               area_terreno = %(area_terreno)s,
                               quartos = %(quartos)s,
                               banheiros = %(banheiros)s,
                               suites = %(suites)s,
                               vagas_garagem = %(vagas_garagem)s,
                               possui_piscina = %(possui_piscina)s,
                               estado_conservacao = %(estado_conservacao)s,
                               padrao_acabamento = %(padrao_acabamento)s,
                               descricao = %(descricao)s,
                               imagem_principal = %(imagem_principal)s,
                               data_ultima_coleta = %(collected_at)s,
                               ativo = 1,
                               atualizado_em = %(collected_at)s
                         WHERE id = %(property_id)s
                        """,
                        {**values, "collected_at": collected_at, "property_id": property_id},
                    )
                    log.info("Imovel atualizado id=%s chave=%s", property_id, record.property_key)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def upsert_images(self, images: list[ImageRecord]) -> None:
        if not images:
            return

        first = images[0]
        conn = self._connect()
        try:
            with conn.cursor() as cursor:
                property_id = self._find_property_id(
                    cursor,
                    first.imobiliaria,
                    first.finalidade,
                    first.codigoImovel,
                    first.urlAnuncio,
                )
                if property_id is None:
                    raise RuntimeError(f"Imovel nao encontrado para gravar imagens: {first.propertyKey}")

                # Somente sincroniza/remova fotos quando a coleta atual encontrou imagens.
                # Isso evita apagar a galeria por uma falha temporaria de lazy-loading.
                current_urls = [img.urlImagem for img in images]
                cursor.execute(
                    f"UPDATE `{self.images_table}` SET principal = 0 WHERE imovel_id = %s",
                    (property_id,),
                )

                for image in images:
                    cursor.execute(
                        f"""
                        SELECT id
                          FROM `{self.images_table}`
                         WHERE imovel_id = %s AND url_imagem = %s
                         LIMIT 1
                        """,
                        (property_id, image.urlImagem),
                    )
                    row = cursor.fetchone()
                    if row:
                        cursor.execute(
                            f"""
                            UPDATE `{self.images_table}`
                               SET ordem = %s, principal = %s
                             WHERE id = %s
                            """,
                            (image.ordem, int(image.imagemPrincipal), int(row["id"])),
                        )
                    else:
                        cursor.execute(
                            f"""
                            INSERT INTO `{self.images_table}`
                                (imovel_id, url_imagem, ordem, principal, criado_em)
                            VALUES (%s, %s, %s, %s, %s)
                            """,
                            (
                                property_id,
                                image.urlImagem,
                                image.ordem,
                                int(image.imagemPrincipal),
                                self._mysql_datetime(image.dataUltimaColeta),
                            ),
                        )

                placeholders = ",".join(["%s"] * len(current_urls))
                cursor.execute(
                    f"""
                    DELETE FROM `{self.images_table}`
                     WHERE imovel_id = %s
                       AND url_imagem NOT IN ({placeholders})
                    """,
                    [property_id, *current_urls],
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def mark_missing_as_inactive(
        self,
        imobiliaria: str,
        finalidade: str,
        seen_property_keys: set[str],
        collected_at: datetime,
    ) -> None:
        finalidade = finalidade.upper()
        if not seen_property_keys:
            log.warning("Inativacao ignorada: nenhuma chave persistida com sucesso")
            return

        seen_codes: set[str] = set()
        seen_urls: set[str] = set()
        prefix = f"{imobiliaria}|{finalidade}|"
        for key in seen_property_keys:
            identity = key[len(prefix):] if key.startswith(prefix) else key
            if identity.startswith("http://") or identity.startswith("https://"):
                seen_urls.add(identity)
            else:
                seen_codes.add(identity)

        now = self._mysql_datetime(collected_at)
        conn = self._connect()
        try:
            with conn.cursor() as cursor:
                conditions: list[str] = []
                seen_params: list[Any] = []
                if seen_codes:
                    placeholders = ",".join(["%s"] * len(seen_codes))
                    conditions.append(f"codigo_imovel IN ({placeholders})")
                    seen_params.extend(sorted(seen_codes))
                if seen_urls:
                    placeholders = ",".join(["%s"] * len(seen_urls))
                    conditions.append(f"url_anuncio IN ({placeholders})")
                    seen_params.extend(sorted(seen_urls))

                if not conditions:
                    log.warning("Inativacao ignorada: chaves vistas nao puderam ser normalizadas")
                    return

                seen_clause = " OR ".join(conditions)
                cursor.execute(
                    f"""
                    UPDATE `{self.properties_table}`
                       SET ativo = 0,
                           atualizado_em = %s
                     WHERE imobiliaria = %s
                       AND finalidade = %s
                       AND ativo = 1
                       AND NOT ({seen_clause})
                    """,
                    [now, imobiliaria, finalidade, *seen_params],
                )
                log.info(
                    "Imoveis marcados como inativos para %s/%s: %d",
                    imobiliaria,
                    finalidade,
                    cursor.rowcount,
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


class DryRunRepository(DestinationRepository):
    def upsert_property(self, record: PropertyRecord) -> None:
        log.info("DRY-RUN property: %s", record.property_key)

    def upsert_images(self, images: list[ImageRecord]) -> None:
        log.info("DRY-RUN images: %d", len(images))

    def mark_missing_as_inactive(
        self,
        imobiliaria: str,
        finalidade: str,
        seen_property_keys: set[str],
        collected_at: datetime,
    ) -> None:
        log.info(
            "DRY-RUN inactive check skipped: %s/%s; seen=%d",
            imobiliaria,
            finalidade,
            len(seen_property_keys),
        )


# ===== service.py =====
log = logging.getLogger(__name__)


def run_collection(
    finalidade: str,
    repository: DestinationRepository,
    allowed_types: set[str] | None = None,
) -> dict:
    scraper = ImobiliariaParanaScraper()
    records, errors = scraper.scrape(finalidade, allowed_types=allowed_types)

    seen: set[str] = set()
    for record in records:
        try:
            repository.upsert_property(record)
            repository.upsert_images(to_image_records(record))
            seen.add(record.property_key)
        except Exception as exc:
            # Um erro de persistencia de um imovel tambem nao interrompe o lote.
            log.exception("Erro persistindo %s", record.property_key)
            errors.append({"url": record.urlAnuncio, "erro": repr(exc), "fase": "persistencia"})

    # Importante: so inativar se a descoberta da listagem tiver produzido resultados.
    # Evita inativacao em massa por falha temporaria da origem.
    if records:
        collected_at = max(r.dataUltimaColeta for r in records)
        repository.mark_missing_as_inactive(
            imobiliaria=IMOBILIARIA,
            finalidade=finalidade.upper(),
            seen_property_keys=seen,
            collected_at=collected_at,
        )
    else:
        log.warning("Nenhum registro valido; inativacao foi pulada por seguranca")

    return {
        "finalidade": finalidade.upper(),
        "coletados": len(records),
        "persistidos": len(seen),
        "erros": errors,
    }


# ===== DAGs =====
DEFAULT_ARGS = {
    "owner": "data-engineering",
    "retries": 2,
}


@dag(
    dag_id="scrape_imobiliaria_parana_venda",
    start_date=datetime(2026, 8, 1),
    schedule="0 6 * * *",
    catchup=False,
    default_args=DEFAULT_ARGS,
    max_active_runs=1,
    tags=["scraping", "imoveis", "imobiliaria-parana", "venda"],
)
def venda_dag():
    @task
    def collect():
        repository = MySQLRepository(
            conn_id="ProjetoIntegrador",
            database="moravdb",
            properties_table="imoveis",
            images_table="imovel_imagens",
        )
        return run_collection(
            finalidade="VENDA",
            repository=repository,
            allowed_types={"CASA", "APARTAMENTO", "TERRENO"},
        )

    collect()


@dag(
    dag_id="scrape_imobiliaria_parana_locacao",
    start_date=datetime(2026, 8, 1),
    schedule="30 6 * * *",
    catchup=False,
    default_args=DEFAULT_ARGS,
    max_active_runs=1,
    tags=["scraping", "imoveis", "imobiliaria-parana", "locacao"],
)
def locacao_dag():
    @task
    def collect():
        # A coluna finalidade separa VENDA de LOCACAO no mesmo destino.
        repository = MySQLRepository(
            conn_id="ProjetoIntegrador",
            database="moravdb",
            properties_table="imoveis",
            images_table="imovel_imagens",
        )
        return run_collection(
            finalidade="LOCACAO",
            repository=repository,
            allowed_types={"CASA", "APARTAMENTO", "TERRENO"},
        )

    collect()


venda_dag()
locacao_dag()
