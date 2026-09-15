from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from ..database import get_db
from .. import models, schemas
from ..auth import get_admin_atual, hash_senha

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def _serializar_usuario(u: models.Usuario):
    return {
        "id": u.id,
        "nome": u.nome,
        "email": u.email,
        "role": u.role,
        "licenca_ativa": u.licenca_ativa,
        "criado_em": u.criado_em.isoformat() if u.criado_em else None,
    }


@router.get("/usuarios")
def listar_usuarios(admin=Depends(get_admin_atual), db: Session = Depends(get_db)):
    usuarios = db.query(models.Usuario).order_by(models.Usuario.id).all()
    return [_serializar_usuario(u) for u in usuarios]


@router.post("/usuarios")
def criar_usuario(dados: schemas.UsuarioCreate, admin=Depends(get_admin_atual), db: Session = Depends(get_db)):
    existe = db.query(models.Usuario).filter(models.Usuario.email == dados.email).first()
    if existe:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")

    usuario = models.Usuario(
        nome=dados.nome,
        email=dados.email,
        senha_hash=hash_senha(dados.senha),
        role="aluno",
        licenca_ativa=True,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return _serializar_usuario(usuario)


@router.patch("/usuarios/{usuario_id}/licenca")
def toggle_licenca(usuario_id: int, admin=Depends(get_admin_atual), db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if usuario.role == "admin":
        raise HTTPException(status_code=400, detail="Não é possível alterar licença do admin")
    usuario.licenca_ativa = not usuario.licenca_ativa
    db.commit()
    return {"id": usuario.id, "licenca_ativa": usuario.licenca_ativa}


@router.delete("/usuarios/{usuario_id}")
def deletar_usuario(usuario_id: int, admin=Depends(get_admin_atual), db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if usuario.role == "admin":
        raise HTTPException(status_code=400, detail="Não é possível deletar o admin")
    db.delete(usuario)
    db.commit()
    return {"mensagem": "Usuário deletado com sucesso"}


@router.get("/metricas")
def metricas(admin=Depends(get_admin_atual), db: Session = Depends(get_db)):
    total_usuarios = db.query(models.Usuario).filter(models.Usuario.role == "aluno").count()
    usuarios_ativos = db.query(models.Usuario).filter(
        models.Usuario.role == "aluno", models.Usuario.licenca_ativa == True
    ).count()

    agora = datetime.utcnow()
    sete_dias_atras = agora - timedelta(days=7)
    inicio_hoje = agora.replace(hour=0, minute=0, second=0, microsecond=0)

    logins_semana = db.query(models.MetricaAcesso).filter(
        models.MetricaAcesso.data_acesso >= sete_dias_atras,
        models.MetricaAcesso.acao == "login",
    ).count()

    logins_hoje = db.query(models.MetricaAcesso).filter(
        models.MetricaAcesso.data_acesso >= inicio_hoje,
        models.MetricaAcesso.acao == "login",
    ).count()

    return {
        "total_usuarios": total_usuarios,
        "usuarios_ativos": usuarios_ativos,
        "logins_hoje": logins_hoje,
        "logins_ultimos_7_dias": logins_semana,
    }