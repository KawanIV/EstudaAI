from pydantic import BaseModel, EmailStr
from typing import Optional


class UsuarioCreate(BaseModel):
    nome: str
    email: EmailStr
    senha: str


class UsuarioLogin(BaseModel):
    email: EmailStr
    senha: str


class PlanoCreate(BaseModel):
    nome: str
    descricao: Optional[str] = None


class MateriaCreate(BaseModel):
    nome: str
    ordem: Optional[int] = 0


class TopicoCreate(BaseModel):
    numero: Optional[str] = None
    nome: str
    ordem: Optional[int] = 0


class SubtopicoCreate(BaseModel):
    numero: Optional[str] = None
    nome: str
    ordem: Optional[int] = 0