import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import get_usuario_atual

router = APIRouter(prefix="/api/estudos", tags=["Estudos"])

UPLOAD_DIR = "uploads"


def verificar_dono_plano(plano_id: int, usuario_id: int, db: Session):
    plano = db.query(models.PlanoEstudo).filter(
        models.PlanoEstudo.id == plano_id, models.PlanoEstudo.usuario_id == usuario_id
    ).first()
    if not plano:
        raise HTTPException(status_code=404, detail="Plano não encontrado")
    return plano


# ---------- PLANOS ----------
@router.get("/planos")
def listar_planos(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    return db.query(models.PlanoEstudo).filter(models.PlanoEstudo.usuario_id == usuario.id).all()


@router.post("/planos")
def criar_plano(dados: schemas.PlanoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    plano = models.PlanoEstudo(usuario_id=usuario.id, nome=dados.nome, descricao=dados.descricao)
    db.add(plano)
    db.commit()
    db.refresh(plano)
    return plano


@router.delete("/planos/{plano_id}")
def deletar_plano(plano_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    plano = verificar_dono_plano(plano_id, usuario.id, db)
    db.delete(plano)
    db.commit()
    return {"mensagem": "Plano deletado"}


# ---------- MATÉRIAS ----------
@router.post("/planos/{plano_id}/materias")
def criar_materia(plano_id: int, dados: schemas.MateriaCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    verificar_dono_plano(plano_id, usuario.id, db)
    materia = models.Materia(plano_id=plano_id, nome=dados.nome, ordem=dados.ordem or 0)
    db.add(materia)
    db.commit()
    db.refresh(materia)
    return materia


@router.delete("/materias/{materia_id}")
def deletar_materia(materia_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    db.delete(materia)
    db.commit()
    return {"mensagem": "Matéria deletada"}


# ---------- TÓPICOS ----------
@router.post("/materias/{materia_id}/topicos")
def criar_topico(materia_id: int, dados: schemas.TopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    topico = models.Topico(materia_id=materia_id, numero=dados.numero, nome=dados.nome, ordem=dados.ordem or 0)
    db.add(topico)
    db.commit()
    db.refresh(topico)
    return topico


# ---------- SUBTÓPICOS ----------
@router.post("/topicos/{topico_id}/subtopicos")
def criar_subtopico(topico_id: int, dados: schemas.SubtopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    sub = models.Subtopico(topico_id=topico_id, numero=dados.numero, nome=dados.nome, ordem=dados.ordem or 0)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


# ---------- CONTEÚDOS (texto, link, PDF) ----------
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
        models.Subtopico.id == subtopico_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")

    url_arquivo = None
    if tipo == "pdf" and arquivo:
        nome_unico = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho = os.path.join(UPLOAD_DIR, nome_unico)
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
        url_arquivo = f"/uploads/{nome_unico}"

    conteudo = models.Conteudo(
        subtopico_id=subtopico_id, tipo=tipo, titulo=titulo,
        texto=texto, url_link=url_link, url_arquivo=url_arquivo,
    )
    db.add(conteudo)
    db.commit()
    db.refresh(conteudo)
    return conteudo


@router.delete("/conteudos/{conteudo_id}")
def deletar_conteudo(conteudo_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    conteudo = db.query(models.Conteudo).join(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Conteudo.id == conteudo_id, models.PlanoEstudo.usuario_id == usuario.id
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


# ---------- ÁRVORE COMPLETA ----------
@router.get("/arvore")
def arvore_completa(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    planos = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.usuario_id == usuario.id).all()
    resultado = []
    for plano in planos:
        materias_list = []
        for m in plano.materias:
            topicos_list = []
            for t in m.topicos:
                subs_list = []
                for s in t.subtopicos:
                    subs_list.append({
                        "id": s.id, "numero": s.numero, "nome": s.nome,
                        "conteudos": [{"id": c.id, "tipo": c.tipo, "titulo": c.titulo,
                                       "texto": c.texto, "url_arquivo": c.url_arquivo,
                                       "url_link": c.url_link} for c in s.conteudos],
                    })
                topicos_list.append({"id": t.id, "numero": t.numero, "nome": t.nome, "subtopicos": subs_list})
            materias_list.append({"id": m.id, "nome": m.nome, "topicos": topicos_list})
        resultado.append({"id": plano.id, "nome": plano.nome, "materias": materias_list})
    return resultado

# ---------- EDITAR (RENOMEAR) ----------

@router.patch("/planos/{plano_id}")
def editar_plano(plano_id: int, dados: schemas.PlanoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    plano = verificar_dono_plano(plano_id, usuario.id, db)
    plano.nome = dados.nome
    if dados.descricao is not None:
        plano.descricao = dados.descricao
    db.commit()
    db.refresh(plano)
    return plano


@router.patch("/materias/{materia_id}")
def editar_materia(materia_id: int, dados: schemas.MateriaCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
        models.Materia.id == materia_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not materia:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")
    materia.nome = dados.nome
    db.commit()
    db.refresh(materia)
    return materia


@router.patch("/topicos/{topico_id}")
def editar_topico(topico_id: int, dados: schemas.TopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    topico = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Topico.id == topico_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not topico:
        raise HTTPException(status_code=404, detail="Tópico não encontrado")
    topico.nome = dados.nome
    if dados.numero is not None:
        topico.numero = dados.numero
    db.commit()
    db.refresh(topico)
    return topico


@router.patch("/subtopicos/{subtopico_id}")
def editar_subtopico(subtopico_id: int, dados: schemas.SubtopicoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    sub = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Subtopico.id == subtopico_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subtópico não encontrado")
    sub.nome = dados.nome
    if dados.numero is not None:
        sub.numero = dados.numero
    db.commit()
    db.refresh(sub)
    return sub


@router.patch("/conteudos/{conteudo_id}")
def editar_conteudo(conteudo_id: int, titulo: str = Form(None), texto: str = Form(None),
                    url_link: str = Form(None), usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    conteudo = db.query(models.Conteudo).join(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
        models.Conteudo.id == conteudo_id, models.PlanoEstudo.usuario_id == usuario.id
    ).first()
    if not conteudo:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")
    if titulo is not None: conteudo.titulo = titulo
    if texto is not None: conteudo.texto = texto
    if url_link is not None: conteudo.url_link = url_link
    db.commit()
    db.refresh(conteudo)
    return conteudo