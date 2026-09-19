import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import get_usuario_atual

router = APIRouter(prefix="/api/estudos", tags=["Estudos"])

UPLOAD_DIR = "uploads"

STATUS_VALIDOS = {"adicionado", "em_estudo", "concluido"}
EXTENSOES_PERMITIDAS = {".pdf", ".docx", ".jpg", ".jpeg", ".png"}


# ==========================================================
# HELPERS
# ==========================================================

def verificar_dono_plano(plano_id: int, usuario_id: int, db: Session):
    plano = db.query(models.PlanoEstudo).filter(
        models.PlanoEstudo.id == plano_id,
        models.PlanoEstudo.usuario_id == usuario_id
    ).first()
    if not plano:
        raise HTTPException(status_code=404, detail="Plano não encontrado")
    return plano


def verificar_categoria_do_usuario(categoria_id: int, usuario_id: int, db: Session):
    """Retorna a categoria se ela for do usuário. Senão, 404."""
    if categoria_id is None:
        return None
    cat = db.query(models.Categoria).filter(
        models.Categoria.id == categoria_id,
        models.Categoria.usuario_id == usuario_id
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    return cat


def calcular_status_agregado(statuses_filhos: list[str]) -> tuple[str, int]:
    if not statuses_filhos:
        return ("adicionado", 0)

    total = len(statuses_filhos)
    concluidos = sum(1 for s in statuses_filhos if s == "concluido")
    em_estudo = sum(1 for s in statuses_filhos if s == "em_estudo")
    percentual = round((concluidos / total) * 100)

    if concluidos == total:
        return ("concluido", 100)
    if concluidos == 0 and em_estudo == 0:
        return ("adicionado", 0)
    return ("em_estudo", percentual)


def status_do_subtopico(sub: models.Subtopico) -> tuple[str, int]:
    mapa = {"adicionado": 0, "em_estudo": 50, "concluido": 100}
    return (sub.status or "adicionado", mapa.get(sub.status, 0))


def status_do_topico(top: models.Topico) -> tuple[str, int]:
    total = len(top.subtopicos)
    if total == 0:
        mapa = {"adicionado": 0, "em_estudo": 50, "concluido": 100}
        return (top.status or "adicionado", mapa.get(top.status, 0))

    concluidos = sum(1 for s in top.subtopicos if s.status == "concluido")
    percentual = round((concluidos / total) * 100)

    if top.status == "concluido":
        return ("concluido", 100)
    if top.status == "em_estudo":
        return ("em_estudo", percentual)
    if percentual == 100:
        return ("concluido", 100)
    if percentual > 0:
        return ("em_estudo", percentual)
    return ("adicionado", 0)


def status_da_materia(mat: models.Materia) -> tuple[str, int]:
    todos_status = []
    for top in mat.topicos:
        for sub in top.subtopicos:
            todos_status.append(sub.status or "adicionado")
    return calcular_status_agregado(todos_status)


def status_do_plano(plano: models.PlanoEstudo) -> tuple[str, int]:
    todos_status = []
    for mat in plano.materias:
        for top in mat.topicos:
            for sub in top.subtopicos:
                todos_status.append(sub.status or "adicionado")
    return calcular_status_agregado(todos_status)


def serializar_categoria(cat):
    """Retorna {id, nome} ou None."""
    if cat is None:
        return None
    return {"id": cat.id, "nome": cat.nome}


# ==========================================================
# CATEGORIAS
# ==========================================================

@router.get("/categorias")
def listar_categorias(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    cats = db.query(models.Categoria).filter(
        models.Categoria.usuario_id == usuario.id
    ).order_by(models.Categoria.nome.asc()).all()
    return [serializar_categoria(c) for c in cats]


@router.post("/categorias")
def criar_categoria(dados: schemas.CategoriaCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existente = db.query(models.Categoria).filter(
        models.Categoria.usuario_id == usuario.id,
        models.Categoria.nome == nome
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Já existe uma categoria com esse nome")
    cat = models.Categoria(usuario_id=usuario.id, nome=nome)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return serializar_categoria(cat)


@router.patch("/categorias/{categoria_id}")
def editar_categoria(categoria_id: int, dados: schemas.CategoriaUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    cat = verificar_categoria_do_usuario(categoria_id, usuario.id, db)
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existente = db.query(models.Categoria).filter(
        models.Categoria.usuario_id == usuario.id,
        models.Categoria.nome == nome,
        models.Categoria.id != categoria_id
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Já existe outra categoria com esse nome")
    cat.nome = nome
    db.commit()
    db.refresh(cat)
    return serializar_categoria(cat)


@router.delete("/categorias/{categoria_id}")
def deletar_categoria(categoria_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    cat = verificar_categoria_do_usuario(categoria_id, usuario.id, db)
    db.delete(cat)
    db.commit()
    return {"mensagem": "Categoria deletada"}


# ==========================================================
# ÁRVORE COMPLETA
# ==========================================================

@router.get("/arvore")
def arvore_completa(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    planos = db.query(models.PlanoEstudo).filter(
        models.PlanoEstudo.usuario_id == usuario.id
    ).all()

    resultado = []
    for plano in planos:
        plano_status, plano_pct = status_do_plano(plano)

        materias_list = []
        for m in plano.materias:
            mat_status, mat_pct = status_da_materia(m)

            topicos_list = []
            for t in m.topicos:
                top_status, top_pct = status_do_topico(t)

                subs_list = []
                for s in t.subtopicos:
                    sub_status, sub_pct = status_do_subtopico(s)
                    subs_list.append({
                        "id": s.id,
                        "numero": s.numero,
                        "nome": s.nome,
                        "categoria": serializar_categoria(s.categoria),
                        "status": sub_status,
                        "porcentagem": sub_pct,
                        "conteudos": [
                            {
                                "id": c.id, "tipo": c.tipo, "titulo": c.titulo,
                                "texto": c.texto, "url_arquivo": c.url_arquivo,
                                "url_link": c.url_link
                            } for c in s.conteudos
                        ],
                    })

                topicos_list.append({
                    "id": t.id, "numero": t.numero, "nome": t.nome,
                    "categoria": serializar_categoria(t.categoria),
                    "status": top_status,
                    "porcentagem": top_pct,
                    "subtopicos": subs_list,
                })

            materias_list.append({
                "id": m.id, "nome": m.nome,
                "categoria": serializar_categoria(m.categoria),
                "status": mat_status,
                "porcentagem": mat_pct,
                "topicos": topicos_list,
            })

        resultado.append({
            "id": plano.id,
            "nome": plano.nome,
            "categoria": serializar_categoria(plano.categoria),
            "status": plano_status,
            "porcentagem": plano_pct,
            "materias": materias_list,
        })

    return resultado


# ==========================================================
# PLANOS
# ==========================================================

@router.get("/planos")
def listar_planos(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    return db.query(models.PlanoEstudo).filter(
        models.PlanoEstudo.usuario_id == usuario.id
    ).all()


@router.post("/planos")
def criar_plano(dados: schemas.PlanoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
    plano = models.PlanoEstudo(
        usuario_id=usuario.id,
        nome=dados.nome,
        descricao=dados.descricao,
        categoria_id=dados.categoria_id,
    )
    db.add(plano)
    db.commit()
    db.refresh(plano)
    return plano


@router.patch("/planos/{plano_id}")
def editar_plano(plano_id: int, dados: schemas.PlanoUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    plano = verificar_dono_plano(plano_id, usuario.id, db)
    if dados.nome is not None: plano.nome = dados.nome
    if dados.descricao is not None: plano.descricao = dados.descricao
    if "categoria_id" in dados.model_fields_set:
        verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
        plano.categoria_id = dados.categoria_id
    db.commit()
    db.refresh(plano)
    return plano


@router.delete("/planos/{plano_id}")
def deletar_plano(plano_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    plano = verificar_dono_plano(plano_id, usuario.id, db)
    db.delete(plano)
    db.commit()
    return {"mensagem": "Plano deletado"}


# ==========================================================
# MATÉRIAS
# ==========================================================

@router.post("/planos/{plano_id}/materias")
def criar_materia(plano_id: int, dados: schemas.MateriaCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    verificar_dono_plano(plano_id, usuario.id, db)
    verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
    materia = models.Materia(
        plano_id=plano_id, nome=dados.nome,
        ordem=dados.ordem or 0, categoria_id=dados.categoria_id,
    )
    db.add(materia)
    db.commit()
    db.refresh(materia)
    return materia


@router.patch("/materias/{materia_id}")
def editar_materia(materia_id: int, dados: schemas.MateriaUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    if dados.nome is not None: materia.nome = dados.nome
    if "categoria_id" in dados.model_fields_set:
        verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
        materia.categoria_id = dados.categoria_id
    db.commit()
    db.refresh(materia)
    return materia


@router.delete("/materias/{materia_id}")
def deletar_materia(materia_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    db.delete(materia)
    db.commit()
    return {"mensagem": "Matéria deletada"}


# ==========================================================
# TÓPICOS
# ==========================================================

@router.post("/materias/{materia_id}/topicos")
def criar_topico(materia_id: int, dados: schemas.TopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
    topico = models.Topico(
        materia_id=materia_id, numero=dados.numero, nome=dados.nome,
        ordem=dados.ordem or 0, categoria_id=dados.categoria_id,
        status="adicionado",
    )
    db.add(topico)
    db.commit()
    db.refresh(topico)
    return topico


@router.patch("/topicos/{topico_id}")
def editar_topico(topico_id: int, dados: schemas.TopicoUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    if dados.nome is not None: topico.nome = dados.nome
    if dados.numero is not None: topico.numero = dados.numero
    if "categoria_id" in dados.model_fields_set:
        verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
        topico.categoria_id = dados.categoria_id
    db.commit()
    db.refresh(topico)
    return topico


@router.patch("/topicos/{topico_id}/status")
def mudar_status_topico(topico_id: int, dados: schemas.StatusUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    if dados.status not in STATUS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Status inválido. Use: {STATUS_VALIDOS}")
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    topico.status = dados.status
    db.commit()
    db.refresh(topico)
    return {"id": topico.id, "status": topico.status}


@router.delete("/topicos/{topico_id}")
def deletar_topico(topico_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    db.delete(topico)
    db.commit()
    return {"mensagem": "Tópico deletado"}


# ==========================================================
# SUBTÓPICOS
# ==========================================================

@router.post("/topicos/{topico_id}/subtopicos")
def criar_subtopico(topico_id: int, dados: schemas.SubtopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
    sub = models.Subtopico(
        topico_id=topico_id, numero=dados.numero, nome=dados.nome,
        ordem=dados.ordem or 0, categoria_id=dados.categoria_id,
        status="adicionado",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.patch("/subtopicos/{subtopico_id}")
def editar_subtopico(subtopico_id: int, dados: schemas.SubtopicoUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    sub = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Subtopico.id == subtopico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")
    if dados.nome is not None: sub.nome = dados.nome
    if dados.numero is not None: sub.numero = dados.numero
    if "categoria_id" in dados.model_fields_set:
        verificar_categoria_do_usuario(dados.categoria_id, usuario.id, db)
        sub.categoria_id = dados.categoria_id
    db.commit()
    db.refresh(sub)
    return sub


@router.patch("/subtopicos/{subtopico_id}/status")
def mudar_status_subtopico(subtopico_id: int, dados: schemas.StatusUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    if dados.status not in STATUS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Status inválido. Use: {STATUS_VALIDOS}")
    sub = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Subtopico.id == subtopico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")
    sub.status = dados.status
    db.commit()
    db.refresh(sub)
    return {"id": sub.id, "status": sub.status}


@router.delete("/subtopicos/{subtopico_id}")
def deletar_subtopico(subtopico_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    sub = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Subtopico.id == subtopico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")
    db.delete(sub)
    db.commit()
    return {"mensagem": "Subtópico deletado"}


# ==========================================================
# CONTEÚDOS
# ==========================================================

@router.post("/subtopicos/{subtopico_id}/conteudo")
def criar_conteudo(
    subtopico_id: int,
    tipo: str = Form(...),
    titulo: str = Form(None),
    texto: str = Form(None),
    url_link: str = Form(None),
    arquivo: UploadFile = File(None),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    sub = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Subtopico.id == subtopico_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")

    url_arquivo = None
    if arquivo and arquivo.filename:
        ext = os.path.splitext(arquivo.filename)[1].lower()
        if ext not in EXTENSOES_PERMITIDAS:
            raise HTTPException(
                status_code=400,
                detail=f"Extensão {ext} não permitida. Use: {', '.join(sorted(EXTENSOES_PERMITIDAS))}"
            )
        nome_unico = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho = os.path.join(UPLOAD_DIR, nome_unico)
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
        url_arquivo = f"/uploads/{nome_unico}"

    conteudo = models.Conteudo(
        subtopico_id=subtopico_id,
        tipo=tipo,
        titulo=titulo,
        texto=texto,
        url_link=url_link,
        url_arquivo=url_arquivo,
    )
    db.add(conteudo)
    db.commit()
    db.refresh(conteudo)
    return conteudo


@router.delete("/conteudos/{conteudo_id}")
def deletar_conteudo(conteudo_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    conteudo = db.query(models.Conteudo).join(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Conteudo.id == conteudo_id,
        models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not conteudo:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")

    if conteudo.url_arquivo:
        caminho = conteudo.url_arquivo.lstrip("/")
        if os.path.exists(caminho):
            os.remove(caminho)

    db.delete(conteudo)
    db.commit()
    return {"mensagem": "Conteúdo deletado"}