from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from ..auth import verificar_senha, criar_token, get_usuario_atual, hash_senha

router = APIRouter(prefix="/api/auth", tags=["Autenticação"])


@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == form.username).first()
    if not usuario or not verificar_senha(form.password, usuario.senha_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    if not usuario.licenca_ativa:
        raise HTTPException(status_code=403, detail="Licença inativa. Contate o admin.")

    # Registra métrica de acesso
    db.add(models.MetricaAcesso(usuario_id=usuario.id, ip=request.client.host, acao="login"))
    db.commit()

    token = criar_token({"sub": usuario.email, "role": usuario.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": {"id": usuario.id, "nome": usuario.nome, "email": usuario.email, "role": usuario.role},
    }


@router.get("/me")
def me(usuario: models.Usuario = Depends(get_usuario_atual)):
    return {"id": usuario.id, "nome": usuario.nome, "email": usuario.email, "role": usuario.role}