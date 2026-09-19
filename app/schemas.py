from pydantic import BaseModel, EmailStr
from typing import Optional


# ============ USUÁRIOS ============
class UsuarioCreate(BaseModel):
    nome: str
    email: EmailStr
    senha: str


class UsuarioLogin(BaseModel):
    email: EmailStr
    senha: str


# ============ CATEGORIAS ============
class CategoriaCreate(BaseModel):
    nome: str


class CategoriaUpdate(BaseModel):
    nome: str


# ============ PLANOS ============
class PlanoCreate(BaseModel):
    nome: str
    descricao: Optional[str] = None
    categoria_id: Optional[int] = None


class PlanoUpdate(BaseModel):
    nome: Optional[str] = None
    descricao: Optional[str] = None
    categoria_id: Optional[int] = None


# ============ MATÉRIAS ============
class MateriaCreate(BaseModel):
    nome: str
    ordem: Optional[int] = 0
    categoria_id: Optional[int] = None


class MateriaUpdate(BaseModel):
    nome: Optional[str] = None
    categoria_id: Optional[int] = None


# ============ TÓPICOS ============
class TopicoCreate(BaseModel):
    numero: Optional[str] = None
    nome: str
    ordem: Optional[int] = 0
    categoria_id: Optional[int] = None


class TopicoUpdate(BaseModel):
    nome: Optional[str] = None
    numero: Optional[str] = None
    categoria_id: Optional[int] = None


# ============ SUBTÓPICOS ============
class SubtopicoCreate(BaseModel):
    numero: Optional[str] = None
    nome: str
    ordem: Optional[int] = 0
    categoria_id: Optional[int] = None


class SubtopicoUpdate(BaseModel):
    nome: Optional[str] = None
    numero: Optional[str] = None
    categoria_id: Optional[int] = None


# ============ STATUS ============
class StatusUpdate(BaseModel):
    status: str  # "adicionado" | "em_estudo" | "concluido"

# Cores
class UsuarioCorUpdate(BaseModel):
    cor_raiz: str

# ============ MATERIAIS ============
class MaterialCreate(BaseModel):
    nome: str
    materia_id: Optional[int] = None
    url_link: Optional[str] = None


class MaterialUpdate(BaseModel):
    nome: Optional[str] = None
    materia_id: Optional[int] = None
    url_link: Optional[str] = None

# ============ AGENDA ============
class AgendamentoCreate(BaseModel):
    topico_id: Optional[int] = None
    subtopico_id: Optional[int] = None
    data_inicio: str  # ISO 8601 (ex: "2026-09-22T14:00:00")
    data_fim: str     # ISO 8601


class AgendamentoUpdate(BaseModel):
    data_inicio: str
    data_fim: str