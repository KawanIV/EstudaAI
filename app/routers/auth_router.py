from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import verificar_senha, criar_token, get_usuario_atual, hash_senha

router = APIRouter(prefix="/api/auth", tags=["Autenticação"])


def serializar_usuario(u: models.Usuario):
    return {
        "id": u.id,
        "nome": u.nome,
        "email": u.email,
        "role": u.role,
        "cor_raiz": u.cor_raiz or "#8e44ad",
    }


@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == form.username).first()
    if not usuario or not verificar_senha(form.password, usuario.senha_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    if not usuario.licenca_ativa:
        raise HTTPException(status_code=403, detail="Licença inativa. Contate o admin.")

    db.add(models.MetricaAcesso(usuario_id=usuario.id, ip=request.client.host, acao="login"))
    db.commit()

    token = criar_token({"sub": usuario.email, "role": usuario.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": serializar_usuario(usuario),
    }


@router.get("/me")
def me(usuario: models.Usuario = Depends(get_usuario_atual)):
    return serializar_usuario(usuario)


@router.patch("/me/cor")
def atualizar_cor(dados: schemas.UsuarioCorUpdate, usuario: models.Usuario = Depends(get_usuario_atual), db: Session = Depends(get_db)):
    # Lista fixa de cores permitidas
    CORES_PERMITIDAS = {"#8e44ad", "#d4af37", "#2980b9", "#27ae60", "#e74c3c", "#e91e63"}
    if dados.cor_raiz not in CORES_PERMITIDAS:
        raise HTTPException(status_code=400, detail="Cor não permitida")

    usuario.cor_raiz = dados.cor_raiz
    db.commit()
    db.refresh(usuario)
    return serializar_usuario(usuario)