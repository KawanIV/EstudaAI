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
EXTENSOES_PERMITIDAS = {
    # Documentos
    ".pdf", ".docx", ".doc", ".txt", ".md", ".odt", ".rtf", ".csv", ".xlsx", ".xls", ".pptx", ".ppt",
    # Imagens
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp",
    # Códigos
    ".py", ".ipynb", ".js", ".ts", ".html", ".css", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".sql", ".json", ".xml", ".yaml", ".yml",
    # Compactados
    ".zip", ".rar", ".7z", ".tar", ".gz",
    # Outros
    ".tex", ".epub", ".mp3", ".mp4", ".mov", ".wav",
}
STATUS_ATIVIDADE_VALIDOS = {"pendente", "em_andamento", "feito"}

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

def apagar_arquivos_conteudos(conteudos: list, db: Session):
    """
    Apaga do disco os arquivos físicos de uma lista de conteúdos.
    Chamado antes de deletar pais (plano/matéria/tópico/subtópico).
    Não commita nada no banco — só apaga arquivo.
    """
    for c in conteudos:
        if c.url_arquivo:
            caminho = c.url_arquivo.lstrip("/")
            if os.path.exists(caminho):
                try:
                    os.remove(caminho)
                except OSError:
                    pass  # Se falhar (permissão, etc), ignora — o banco segue


def apagar_todos_conteudos_do_subtopico(sub: models.Subtopico, db: Session):
    """Apaga os arquivos de todos os conteúdos de um subtópico."""
    apagar_arquivos_conteudos(sub.conteudos, db)


def apagar_todos_conteudos_do_topico(top: models.Topico, db: Session):
    """Apaga os arquivos dos conteúdos do tópico + de todos os seus subtópicos."""
    apagar_arquivos_conteudos(top.conteudos, db)
    for sub in top.subtopicos:
        apagar_arquivos_conteudos(sub.conteudos, db)


def apagar_todos_conteudos_da_materia(mat: models.Materia, db: Session):
    """Apaga os arquivos dos conteúdos da matéria + tópicos + subtópicos."""
    for top in mat.topicos:
        apagar_arquivos_conteudos(top.conteudos, db)
        for sub in top.subtopicos:
            apagar_arquivos_conteudos(sub.conteudos, db)


def apagar_todos_conteudos_do_plano(plano: models.PlanoEstudo, db: Session):
    """Apaga os arquivos dos conteúdos do plano inteiro (todos os níveis)."""
    for mat in plano.materias:
        for top in mat.topicos:
            apagar_arquivos_conteudos(top.conteudos, db)
            for sub in top.subtopicos:
                apagar_arquivos_conteudos(sub.conteudos, db)

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
# TIPOS DE MATERIAL
# ==========================================================

def serializar_tipo(t):
    if t is None: return None
    return {"id": t.id, "nome": t.nome}


def verificar_tipo_do_usuario(tipo_id: int, usuario_id: int, db: Session):
    if tipo_id is None:
        return None
    t = db.query(models.TipoMaterial).filter(
        models.TipoMaterial.id == tipo_id,
        models.TipoMaterial.usuario_id == usuario_id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tipo não encontrado")
    return t


@router.get("/tipos-material")
def listar_tipos(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    tipos = db.query(models.TipoMaterial).filter(
        models.TipoMaterial.usuario_id == usuario.id
    ).order_by(models.TipoMaterial.nome.asc()).all()

    # Se o usuário ainda não tem nenhum tipo, cria os 4 padrão
    if not tipos:
        padrao = ["Livro", "Anotação", "Trabalho", "Apostila"]
        for nome in padrao:
            db.add(models.TipoMaterial(usuario_id=usuario.id, nome=nome))
        db.commit()
        tipos = db.query(models.TipoMaterial).filter(
            models.TipoMaterial.usuario_id == usuario.id
        ).order_by(models.TipoMaterial.nome.asc()).all()

    return [serializar_tipo(t) for t in tipos]


@router.post("/tipos-material")
def criar_tipo(dados: schemas.TipoMaterialCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existe = db.query(models.TipoMaterial).filter(
        models.TipoMaterial.usuario_id == usuario.id,
        models.TipoMaterial.nome == nome
    ).first()
    if existe:
        raise HTTPException(status_code=400, detail="Já existe um tipo com esse nome")
    t = models.TipoMaterial(usuario_id=usuario.id, nome=nome)
    db.add(t)
    db.commit()
    db.refresh(t)
    return serializar_tipo(t)


@router.patch("/tipos-material/{tipo_id}")
def editar_tipo(tipo_id: int, dados: schemas.TipoMaterialUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    t = verificar_tipo_do_usuario(tipo_id, usuario.id, db)
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existe = db.query(models.TipoMaterial).filter(
        models.TipoMaterial.usuario_id == usuario.id,
        models.TipoMaterial.nome == nome,
        models.TipoMaterial.id != tipo_id
    ).first()
    if existe:
        raise HTTPException(status_code=400, detail="Já existe outro tipo com esse nome")
    t.nome = nome
    db.commit()
    db.refresh(t)
    return serializar_tipo(t)


@router.delete("/tipos-material/{tipo_id}")
def deletar_tipo(tipo_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    t = verificar_tipo_do_usuario(tipo_id, usuario.id, db)
    db.delete(t)
    db.commit()
    return {"mensagem": "Tipo deletado"}

# ==========================================================
# ÁRVORE COMPLETA
# ==========================================================

@router.get("/arvore")
def arvore_completa(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    planos = db.query(models.PlanoEstudo).filter(
        models.PlanoEstudo.usuario_id == usuario.id
    ).all()

    def serializar_conteudo(c):
        return {
            "id": c.id, "tipo": c.tipo, "titulo": c.titulo,
            "texto": c.texto, "url_arquivo": c.url_arquivo,
            "url_link": c.url_link
        }

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
                        "id": s.id, "numero": s.numero, "nome": s.nome,
                        "categoria": serializar_categoria(s.categoria),
                        "status": sub_status, "porcentagem": sub_pct,
                        "conteudos": [serializar_conteudo(c) for c in s.conteudos],
                        "horarios": [_serializar_horario(h, db) for h in s.horarios], 
                    })
                topicos_list.append({
                    "id": t.id, "numero": t.numero, "nome": t.nome,
                    "categoria": serializar_categoria(t.categoria),
                    "status": top_status, "porcentagem": top_pct,
                    "conteudos": [serializar_conteudo(c) for c in t.conteudos],   # 👈 NOVA LINHA
                    "horarios": [_serializar_horario(h, db) for h in t.horarios], 
                    "subtopicos": subs_list,
                })
            materias_list.append({
                "id": m.id, "nome": m.nome,
                "categoria": serializar_categoria(m.categoria),
                "status": mat_status, "porcentagem": mat_pct,
                "topicos": topicos_list,
            })
        resultado.append({
            "id": plano.id, "nome": plano.nome,
            "categoria": serializar_categoria(plano.categoria),
            "status": plano_status, "porcentagem": plano_pct,
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
    # Apaga arquivos físicos antes de deletar no banco
    apagar_todos_conteudos_do_plano(plano, db)
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
    apagar_todos_conteudos_da_materia(materia, db)
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
    apagar_todos_conteudos_do_topico(topico, db)
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
    apagar_todos_conteudos_do_subtopico(sub, db)
    db.delete(sub)
    db.commit()
    return {"mensagem": "Subtópico deletado"}


# ==========================================================
# CONTEÚDOS
# ==========================================================

@router.post("/conteudos")
def criar_conteudo(
    topico_id: int = Form(None),
    subtopico_id: int = Form(None),
    tipo: str = Form(...),
    titulo: str = Form(None),
    texto: str = Form(None),
    url_link: str = Form(None),
    arquivo: UploadFile = File(None),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    if not topico_id and not subtopico_id:
        raise HTTPException(status_code=400, detail="Informe topico_id ou subtopico_id")
    if topico_id and subtopico_id:
        raise HTTPException(status_code=400, detail="Informe apenas um: topico_id ou subtopico_id")

    # Valida que pertence ao usuário
    if topico_id:
        pai = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Topico.id == topico_id,
            models.PlanoEstudo.usuario_id == usuario.id
        ).first()
    else:
        pai = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Subtopico.id == subtopico_id,
            models.PlanoEstudo.usuario_id == usuario.id
        ).first()

    if not pai:
        raise HTTPException(status_code=404, detail="Tópico ou subtópico não encontrado")

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
        topico_id=topico_id,
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
    conteudo = db.query(models.Conteudo).outerjoin(
        models.Topico, models.Conteudo.topico_id == models.Topico.id
    ).outerjoin(
        models.Subtopico, models.Conteudo.subtopico_id == models.Subtopico.id
    ).filter(models.Conteudo.id == conteudo_id).first()

    if not conteudo:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")

    # Valida que o usuário é dono
    dono_id = None
    if conteudo.topico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
            models.Topico.id == conteudo.topico_id
        ).scalar()
    elif conteudo.subtopico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
            models.Subtopico.id == conteudo.subtopico_id
        ).scalar()

    if dono_id != usuario.id:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")

    if conteudo.url_arquivo:
        caminho = conteudo.url_arquivo.lstrip("/")
        if os.path.exists(caminho):
            os.remove(caminho)

    db.delete(conteudo)
    db.commit()
    return {"mensagem": "Conteúdo deletado"}

@router.patch("/conteudos/{conteudo_id}")
def editar_conteudo(
    conteudo_id: int,
    titulo: str = Form(None),
    texto: str = Form(None),
    url_link: str = Form(None),
    arquivo: UploadFile = File(None),
    remover_arquivo: str = Form(None),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    conteudo = db.query(models.Conteudo).filter(models.Conteudo.id == conteudo_id).first()
    if not conteudo:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")

    # Valida que é do usuário
    dono_id = None
    if conteudo.topico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
            models.Topico.id == conteudo.topico_id
        ).scalar()
    elif conteudo.subtopico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
            models.Subtopico.id == conteudo.subtopico_id
        ).scalar()

    if dono_id != usuario.id:
        raise HTTPException(status_code=404, detail="Conteúdo não encontrado")

    # Atualiza campos de texto (só se vieram)
    if titulo is not None:
        conteudo.titulo = titulo.strip() or None
    if texto is not None:
        conteudo.texto = texto.strip() or None
    if url_link is not None:
        conteudo.url_link = url_link.strip() or None

    # Remoção de arquivo (flag booleana em string "true"/"1")
    if remover_arquivo and remover_arquivo.lower() in ("true", "1", "sim"):
        if conteudo.url_arquivo:
            antigo = conteudo.url_arquivo.lstrip("/")
            if os.path.exists(antigo):
                os.remove(antigo)
        conteudo.url_arquivo = None

    # Novo arquivo substitui o antigo
    if arquivo and arquivo.filename:
        ext = os.path.splitext(arquivo.filename)[1].lower()
        if ext not in EXTENSOES_PERMITIDAS:
            raise HTTPException(
                status_code=400,
                detail=f"Extensão {ext} não permitida. Use: {', '.join(sorted(EXTENSOES_PERMITIDAS))}"
            )
        if conteudo.url_arquivo:
            antigo = conteudo.url_arquivo.lstrip("/")
            if os.path.exists(antigo):
                os.remove(antigo)
        nome_unico = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho = os.path.join(UPLOAD_DIR, nome_unico)
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
        conteudo.url_arquivo = f"/uploads/{nome_unico}"

    db.commit()
    db.refresh(conteudo)
    return conteudo

# ==========================================================
# MATERIAIS (biblioteca pessoal)
# ==========================================================

@router.get("/materiais")
def listar_materiais(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    materiais = db.query(models.Material).filter(
        models.Material.usuario_id == usuario.id
    ).order_by(models.Material.criado_em.desc()).all()

    return [
        {
            "id": m.id,
            "nome": m.nome,
            "url_arquivo": m.url_arquivo,
            "url_link": m.url_link,
            "materia_id": m.materia_id,
            "materia_nome": m.materia.nome if m.materia else None,
            "tipo_id": m.tipo_id,
            "tipo_nome": m.tipo.nome if m.tipo else None,
            "ultima_pagina": m.ultima_pagina or 1,
            "criado_em": m.criado_em.isoformat() if m.criado_em else None,
        }
        for m in materiais
    ]

@router.post("/materiais")
def criar_material(
    nome: str = Form(...),
    materia_id: str = Form(None),
    tipo_id: str = Form(None),
    url_link: str = Form(None),
    arquivo: UploadFile = File(None),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    nome_limpo = nome.strip()
    if not nome_limpo:
        raise HTTPException(status_code=400, detail="Nome é obrigatório")

    mat_id = None
    if materia_id and materia_id.strip():
        try:
            mat_id = int(materia_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="materia_id inválido")
        materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
            models.Materia.id == mat_id,
            models.PlanoEstudo.usuario_id == usuario.id
        ).first()
        if not materia:
            raise HTTPException(status_code=404, detail="Matéria não encontrada")

    tip_id = None
    if tipo_id and tipo_id.strip():
        try:
            tip_id = int(tipo_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="tipo_id inválido")
        verificar_tipo_do_usuario(tip_id, usuario.id, db)

    url_arquivo = None
    if arquivo and arquivo.filename:
        ext = os.path.splitext(arquivo.filename)[1].lower()
        if ext not in EXTENSOES_PERMITIDAS:
            raise HTTPException(status_code=400, detail=f"Extensão {ext} não permitida.")
        nome_unico = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho = os.path.join(UPLOAD_DIR, nome_unico)
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
        url_arquivo = f"/uploads/{nome_unico}"

    material = models.Material(
        usuario_id=usuario.id,
        materia_id=mat_id,
        tipo_id=tip_id,
        nome=nome_limpo,
        url_arquivo=url_arquivo,
        url_link=url_link.strip() if url_link else None,
    )
    db.add(material)
    db.commit()
    db.refresh(material)
    return {
        "id": material.id, "nome": material.nome,
        "url_arquivo": material.url_arquivo, "url_link": material.url_link,
        "materia_id": material.materia_id, "tipo_id": material.tipo_id,
    }


@router.patch("/materiais/{material_id}")
def editar_material(
    material_id: int,
    nome: str = Form(None),
    materia_id: str = Form(None),
    tipo_id: str = Form(None),
    url_link: str = Form(None),
    arquivo: UploadFile = File(None),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario.id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    if nome is not None:
        nome_limpo = nome.strip()
        if not nome_limpo:
            raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
        material.nome = nome_limpo

    if materia_id is not None:
        if materia_id.strip() == "":
            material.materia_id = None
        else:
            try:
                mat_id = int(materia_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="materia_id inválido")
            materia = db.query(models.Materia).join(models.PlanoEstudo).filter(
                models.Materia.id == mat_id,
                models.PlanoEstudo.usuario_id == usuario.id
            ).first()
            if not materia:
                raise HTTPException(status_code=404, detail="Matéria não encontrada")
            material.materia_id = mat_id

    if tipo_id is not None:
        if tipo_id.strip() == "":
            material.tipo_id = None
        else:
            try:
                tip_id = int(tipo_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="tipo_id inválido")
            verificar_tipo_do_usuario(tip_id, usuario.id, db)
            material.tipo_id = tip_id

    if url_link is not None:
        material.url_link = url_link.strip() or None

    if arquivo and arquivo.filename:
        ext = os.path.splitext(arquivo.filename)[1].lower()
        if ext not in EXTENSOES_PERMITIDAS:
            raise HTTPException(status_code=400, detail=f"Extensão {ext} não permitida.")
        if material.url_arquivo:
            antigo = material.url_arquivo.lstrip("/")
            if os.path.exists(antigo):
                os.remove(antigo)
        nome_unico = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho = os.path.join(UPLOAD_DIR, nome_unico)
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
        material.url_arquivo = f"/uploads/{nome_unico}"

    db.commit()
    db.refresh(material)
    return {
        "id": material.id, "nome": material.nome,
        "url_arquivo": material.url_arquivo, "url_link": material.url_link,
        "materia_id": material.materia_id, "tipo_id": material.tipo_id,
    }


@router.delete("/materiais/{material_id}")
def deletar_material(material_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario.id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    if material.url_arquivo:
        caminho = material.url_arquivo.lstrip("/")
        if os.path.exists(caminho):
            try:
                os.remove(caminho)
            except OSError:
                pass

    db.delete(material)
    db.commit()
    return {"mensagem": "Material deletado"}

# ==========================================================
# TIPOS DE ATIVIDADE
# ==========================================================

def serializar_tipo_atividade(t):
    if t is None: return None
    return {"id": t.id, "nome": t.nome}


def verificar_tipo_atividade_do_usuario(tipo_id: int, usuario_id: int, db: Session):
    if tipo_id is None:
        return None
    t = db.query(models.TipoAtividade).filter(
        models.TipoAtividade.id == tipo_id,
        models.TipoAtividade.usuario_id == usuario_id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tipo de atividade não encontrado")
    return t


@router.get("/tipos-atividade")
def listar_tipos_atividade(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    tipos = db.query(models.TipoAtividade).filter(
        models.TipoAtividade.usuario_id == usuario.id
    ).order_by(models.TipoAtividade.nome.asc()).all()

    if not tipos:
        padrao = ["Trabalho", "Prova", "Projeto", "Resumo", "Lista de Exercícios"]
        for nome in padrao:
            db.add(models.TipoAtividade(usuario_id=usuario.id, nome=nome))
        db.commit()
        tipos = db.query(models.TipoAtividade).filter(
            models.TipoAtividade.usuario_id == usuario.id
        ).order_by(models.TipoAtividade.nome.asc()).all()

    return [serializar_tipo_atividade(t) for t in tipos]


@router.post("/tipos-atividade")
def criar_tipo_atividade(dados: schemas.TipoAtividadeCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existe = db.query(models.TipoAtividade).filter(
        models.TipoAtividade.usuario_id == usuario.id,
        models.TipoAtividade.nome == nome
    ).first()
    if existe:
        raise HTTPException(status_code=400, detail="Já existe um tipo com esse nome")
    t = models.TipoAtividade(usuario_id=usuario.id, nome=nome)
    db.add(t)
    db.commit()
    db.refresh(t)
    return serializar_tipo_atividade(t)


@router.patch("/tipos-atividade/{tipo_id}")
def editar_tipo_atividade(tipo_id: int, dados: schemas.TipoAtividadeUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    t = verificar_tipo_atividade_do_usuario(tipo_id, usuario.id, db)
    nome = dados.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
    existe = db.query(models.TipoAtividade).filter(
        models.TipoAtividade.usuario_id == usuario.id,
        models.TipoAtividade.nome == nome,
        models.TipoAtividade.id != tipo_id
    ).first()
    if existe:
        raise HTTPException(status_code=400, detail="Já existe outro tipo com esse nome")
    t.nome = nome
    db.commit()
    db.refresh(t)
    return serializar_tipo_atividade(t)


@router.delete("/tipos-atividade/{tipo_id}")
def deletar_tipo_atividade(tipo_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    t = verificar_tipo_atividade_do_usuario(tipo_id, usuario.id, db)
    db.delete(t)
    db.commit()
    return {"mensagem": "Tipo de atividade deletado"}


# ==========================================================
# ATIVIDADES
# ==========================================================

def _parse_data_entrega(s):
    """Aceita ISO 8601, retorna datetime UTC aware ou None."""
    if not s or not s.strip():
        return None
    return _parse_datetime(s)


def serializar_atividade(a: models.Atividade, db: Session):
    """Retorna atividade + info do nó vinculado (pra mostrar caminho)."""
    caminho = {}
    node_nome = None
    node_tipo = None

    if a.plano_id:
        p = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == a.plano_id).first()
        if p:
            node_nome = p.nome
            node_tipo = "plano"
            caminho = {"plano_id": p.id, "plano_nome": p.nome}
    elif a.materia_id:
        m = db.query(models.Materia).filter(models.Materia.id == a.materia_id).first()
        if m:
            p = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == m.plano_id).first()
            node_nome = m.nome
            node_tipo = "materia"
            caminho = {
                "plano_id": p.id if p else None, "plano_nome": p.nome if p else None,
                "materia_id": m.id, "materia_nome": m.nome,
            }
    elif a.topico_id:
        t = db.query(models.Topico).filter(models.Topico.id == a.topico_id).first()
        if t:
            m = db.query(models.Materia).filter(models.Materia.id == t.materia_id).first()
            p = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == m.plano_id).first() if m else None
            node_nome = f"{t.numero or ''} {t.nome}".strip()
            node_tipo = "topico"
            caminho = {
                "plano_id": p.id if p else None, "plano_nome": p.nome if p else None,
                "materia_id": m.id if m else None, "materia_nome": m.nome if m else None,
                "topico_id": t.id, "topico_nome": node_nome,
            }
    elif a.subtopico_id:
        s = db.query(models.Subtopico).filter(models.Subtopico.id == a.subtopico_id).first()
        if s:
            t = db.query(models.Topico).filter(models.Topico.id == s.topico_id).first()
            m = db.query(models.Materia).filter(models.Materia.id == t.materia_id).first() if t else None
            p = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == m.plano_id).first() if m else None
            node_nome = f"{s.numero or ''} {s.nome}".strip()
            node_tipo = "subtopico"
            caminho = {
                "plano_id": p.id if p else None, "plano_nome": p.nome if p else None,
                "materia_id": m.id if m else None, "materia_nome": m.nome if m else None,
                "topico_id": t.id if t else None, "topico_nome": f"{t.numero or ''} {t.nome}".strip() if t else None,
                "subtopico_id": s.id, "subtopico_nome": node_nome,
            }

    return {
        "id": a.id,
        "nome": a.nome,
        "descricao": a.descricao,
        "data_entrega": a.data_entrega.isoformat() if a.data_entrega else None,
        "status": a.status,
        "tipo": serializar_tipo_atividade(a.tipo),
        "plano_id": a.plano_id,
        "materia_id": a.materia_id,
        "topico_id": a.topico_id,
        "subtopico_id": a.subtopico_id,
        "node_nome": node_nome,
        "node_tipo": node_tipo,
        "caminho": caminho,
        "anexos": [
            {
                "id": an.id,
                "nome_original": an.nome_original,
                "url_arquivo": an.url_arquivo,
            } for an in a.anexos
        ],
        "criado_em": a.criado_em.isoformat() if a.criado_em else None,
    }


def _verificar_vinculo_atividade(dados, usuario_id, db):
    """Valida que um dos IDs veio E que pertence ao usuário. Retorna dict com os campos limpos."""
    ids = {
        "plano_id": getattr(dados, "plano_id", None),
        "materia_id": getattr(dados, "materia_id", None),
        "topico_id": getattr(dados, "topico_id", None),
        "subtopico_id": getattr(dados, "subtopico_id", None),
    }
    preenchidos = {k: v for k, v in ids.items() if v is not None}
    if len(preenchidos) > 1:
        raise HTTPException(status_code=400, detail="Só pode vincular a um nó: plano, matéria, tópico ou subtópico")

    if "plano_id" in preenchidos:
        p = db.query(models.PlanoEstudo).filter(
            models.PlanoEstudo.id == preenchidos["plano_id"],
            models.PlanoEstudo.usuario_id == usuario_id
        ).first()
        if not p: raise HTTPException(status_code=404, detail="Plano não encontrado")
    elif "materia_id" in preenchidos:
        m = db.query(models.Materia).join(models.PlanoEstudo).filter(
            models.Materia.id == preenchidos["materia_id"],
            models.PlanoEstudo.usuario_id == usuario_id
        ).first()
        if not m: raise HTTPException(status_code=404, detail="Matéria não encontrada")
    elif "topico_id" in preenchidos:
        t = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Topico.id == preenchidos["topico_id"],
            models.PlanoEstudo.usuario_id == usuario_id
        ).first()
        if not t: raise HTTPException(status_code=404, detail="Tópico não encontrado")
    elif "subtopico_id" in preenchidos:
        s = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Subtopico.id == preenchidos["subtopico_id"],
            models.PlanoEstudo.usuario_id == usuario_id
        ).first()
        if not s: raise HTTPException(status_code=404, detail="Subtópico não encontrado")

    return ids


@router.get("/atividades")
def listar_atividades(usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    atividades = db.query(models.Atividade).filter(
        models.Atividade.usuario_id == usuario.id
    ).order_by(models.Atividade.data_entrega.asc().nullslast()).all()

    return [serializar_atividade(a, db) for a in atividades]


@router.post("/atividades")
def criar_atividade(dados: schemas.AtividadeCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    nome = (dados.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório")

    if dados.tipo_id is not None:
        verificar_tipo_atividade_do_usuario(dados.tipo_id, usuario.id, db)

    ids = _verificar_vinculo_atividade(dados, usuario.id, db)

    data_entrega = _parse_data_entrega(dados.data_entrega)

    a = models.Atividade(
        usuario_id=usuario.id,
        nome=nome,
        descricao=dados.descricao,
        data_entrega=data_entrega,
        tipo_id=dados.tipo_id,
        plano_id=ids["plano_id"],
        materia_id=ids["materia_id"],
        topico_id=ids["topico_id"],
        subtopico_id=ids["subtopico_id"],
        status="pendente",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return serializar_atividade(a, db)


@router.patch("/atividades/{atividade_id}")
def editar_atividade(atividade_id: int, dados: schemas.AtividadeUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    a = db.query(models.Atividade).filter(
        models.Atividade.id == atividade_id,
        models.Atividade.usuario_id == usuario.id
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")

    if dados.nome is not None:
        nome = dados.nome.strip()
        if not nome:
            raise HTTPException(status_code=400, detail="Nome não pode ser vazio")
        a.nome = nome

    if dados.descricao is not None:
        a.descricao = dados.descricao or None

    if dados.data_entrega is not None:
        a.data_entrega = _parse_data_entrega(dados.data_entrega)

    if dados.tipo_id is not None:
        if dados.tipo_id == 0:
            a.tipo_id = None
        else:
            verificar_tipo_atividade_do_usuario(dados.tipo_id, usuario.id, db)
            a.tipo_id = dados.tipo_id

    # Vínculo: se algum ID foi passado, valida
    if any([dados.plano_id is not None, dados.materia_id is not None,
            dados.topico_id is not None, dados.subtopico_id is not None]):
        # Zera todos e reaplica
        a.plano_id = None
        a.materia_id = None
        a.topico_id = None
        a.subtopico_id = None
        ids = _verificar_vinculo_atividade(dados, usuario.id, db)
        a.plano_id = ids["plano_id"]
        a.materia_id = ids["materia_id"]
        a.topico_id = ids["topico_id"]
        a.subtopico_id = ids["subtopico_id"]

    db.commit()
    db.refresh(a)
    return serializar_atividade(a, db)


@router.patch("/atividades/{atividade_id}/status")
def mudar_status_atividade(atividade_id: int, dados: schemas.AtividadeStatusUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    if dados.status not in STATUS_ATIVIDADE_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Status inválido. Use: {STATUS_ATIVIDADE_VALIDOS}")
    a = db.query(models.Atividade).filter(
        models.Atividade.id == atividade_id,
        models.Atividade.usuario_id == usuario.id
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")
    a.status = dados.status
    db.commit()
    db.refresh(a)
    return serializar_atividade(a, db)

@router.delete("/atividades/{atividade_id}")
def deletar_atividade(atividade_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    a = db.query(models.Atividade).filter(
        models.Atividade.id == atividade_id,
        models.Atividade.usuario_id == usuario.id
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")

    # Apaga todos os arquivos físicos dos anexos
    for an in a.anexos:
        caminho = an.url_arquivo.lstrip("/")
        if os.path.exists(caminho):
            try:
                os.remove(caminho)
            except OSError:
                pass

    db.delete(a)
    db.commit()
    return {"mensagem": "Atividade deletada"}

# ==========================================================
# AGENDA
# ==========================================================

from datetime import datetime


def _parse_datetime(s: str) -> datetime:
    """Aceita ISO 8601 com ou sem timezone. Sempre retorna aware em UTC."""
    from datetime import timezone
    s = s.strip().replace('Z', '+00:00')
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Data inválida: {s}")
    # Se veio naive, assume UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def _aware(dt: datetime) -> datetime:
    """Garante que o datetime seja aware em UTC."""
    from datetime import timezone
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

def _serializar_horario(h: models.HorarioEstudo, db: Session) -> dict:
    """Retorna dados do horário + info do nó pai pra exibir na agenda."""
    # Descobre o nó pai e o caminho (plano > matéria > [tópico] > [subtópico])
    node_nome = ""
    node_tipo = ""
    caminho = {}

    if h.topico_id:
        top = db.query(models.Topico).filter(models.Topico.id == h.topico_id).first()
        if top:
            node_nome = f"{top.numero or ''} {top.nome}".strip()
            node_tipo = "topico"
            mat = db.query(models.Materia).filter(models.Materia.id == top.materia_id).first()
            if mat:
                plano = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == mat.plano_id).first()
                caminho = {
                    "plano_id": plano.id if plano else None,
                    "plano_nome": plano.nome if plano else None,
                    "materia_id": mat.id,
                    "materia_nome": mat.nome,
                }
    elif h.subtopico_id:
        sub = db.query(models.Subtopico).filter(models.Subtopico.id == h.subtopico_id).first()
        if sub:
            node_nome = f"{sub.numero or ''} {sub.nome}".strip()
            node_tipo = "subtopico"
            top = db.query(models.Topico).filter(models.Topico.id == sub.topico_id).first()
            if top:
                mat = db.query(models.Materia).filter(models.Materia.id == top.materia_id).first()
                if mat:
                    plano = db.query(models.PlanoEstudo).filter(models.PlanoEstudo.id == mat.plano_id).first()
                    caminho = {
                        "plano_id": plano.id if plano else None,
                        "plano_nome": plano.nome if plano else None,
                        "materia_id": mat.id,
                        "materia_nome": mat.nome,
                        "topico_id": top.id,
                        "topico_nome": f"{top.numero or ''} {top.nome}".strip(),
                    }

    return {
        "id": h.id,
        "topico_id": h.topico_id,
        "subtopico_id": h.subtopico_id,
        "data_inicio": h.data_inicio.isoformat(),
        "data_fim": h.data_fim.isoformat(),
        "node_nome": node_nome,
        "node_tipo": node_tipo,
        "caminho": caminho,
    }


def _validar_horario(data_inicio: datetime, data_fim: datetime):
    if data_fim <= data_inicio:
        raise HTTPException(status_code=400, detail="Hora de fim deve ser depois da hora de início")


def _verificar_sobreposicao(
    db: Session, usuario_id: int, data_inicio: datetime, data_fim: datetime,
    ignorar_id: int = None
):
    """Verifica se já existe agendamento conflitante do mesmo usuário."""
    # Busca TODOS os horários
    todos = db.query(models.HorarioEstudo).all()

    for h in todos:
        if ignorar_id and h.id == ignorar_id:
            continue

        # Descobre o dono
        dono_id = None
        if h.topico_id:
            dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
                models.Topico.id == h.topico_id
            ).scalar()
        elif h.subtopico_id:
            dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
                models.Subtopico.id == h.subtopico_id
            ).scalar()

        if dono_id != usuario_id:
            continue

        # Conflito se [inicio_novo, fim_novo) intersecta [inicio_existente, fim_existente)
        if data_inicio < _aware(h.data_fim) and data_fim > _aware(h.data_inicio):
            return h

    return None


@router.get("/agenda")
def listar_agenda(
    inicio: str = None,
    fim: str = None,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    """Retorna todos os agendamentos do usuário. Filtro opcional por range."""
    # Busca todos os horários que pertencem a nós do usuário
    todos = db.query(models.HorarioEstudo).all()
    resultado = []
    for h in todos:
        # Confere se é do usuário
        dono_id = None
        if h.topico_id:
            dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
                models.Topico.id == h.topico_id
            ).scalar()
        elif h.subtopico_id:
            dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
                models.Subtopico.id == h.subtopico_id
            ).scalar()

        if dono_id != usuario.id:
            continue

        # Filtro por range (se passado)
        if inicio:
            dt_ini = _parse_datetime(inicio)
            if _aware(h.data_fim) < dt_ini:
                continue
        if fim:
            dt_fim = _parse_datetime(fim)
            if _aware(h.data_inicio) > dt_fim:
                continue

        resultado.append(_serializar_horario(h, db))

    # Ordena por data_inicio
    resultado.sort(key=lambda x: x["data_inicio"])
    return resultado


@router.post("/agendamentos")
def criar_agendamento(
    dados: schemas.AgendamentoCreate,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    if not dados.topico_id and not dados.subtopico_id:
        raise HTTPException(status_code=400, detail="Informe topico_id ou subtopico_id")
    if dados.topico_id and dados.subtopico_id:
        raise HTTPException(status_code=400, detail="Informe apenas um: topico_id ou subtopico_id")

    # Valida dono
    if dados.topico_id:
        pai = db.query(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Topico.id == dados.topico_id,
            models.PlanoEstudo.usuario_id == usuario.id
        ).first()
    else:
        pai = db.query(models.Subtopico).join(models.Topico).join(models.Materia).join(models.PlanoEstudo).filter(
            models.Subtopico.id == dados.subtopico_id,
            models.PlanoEstudo.usuario_id == usuario.id
        ).first()

    if not pai:
        raise HTTPException(status_code=404, detail="Tópico ou subtópico não encontrado")

    dt_inicio = _parse_datetime(dados.data_inicio)
    dt_fim = _parse_datetime(dados.data_fim)
    _validar_horario(dt_inicio, dt_fim)

    conflito = _verificar_sobreposicao(db, usuario.id, dt_inicio, dt_fim)
    if conflito:
        raise HTTPException(
            status_code=409,
            detail=f"Já existe um estudo agendado nesse horário."
        )

    h = models.HorarioEstudo(
        topico_id=dados.topico_id,
        subtopico_id=dados.subtopico_id,
        data_inicio=dt_inicio,
        data_fim=dt_fim,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return _serializar_horario(h, db)


@router.patch("/agendamentos/{agendamento_id}")
def editar_agendamento(
    agendamento_id: int,
    dados: schemas.AgendamentoUpdate,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    h = db.query(models.HorarioEstudo).filter(models.HorarioEstudo.id == agendamento_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    # Valida dono
    dono_id = None
    if h.topico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
            models.Topico.id == h.topico_id
        ).scalar()
    elif h.subtopico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
            models.Subtopico.id == h.subtopico_id
        ).scalar()
    if dono_id != usuario.id:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    dt_inicio = _parse_datetime(dados.data_inicio)
    dt_fim = _parse_datetime(dados.data_fim)
    _validar_horario(dt_inicio, dt_fim)

    conflito = _verificar_sobreposicao(db, usuario.id, dt_inicio, dt_fim, ignorar_id=h.id)
    if conflito:
        raise HTTPException(status_code=409, detail="Já existe um estudo agendado nesse horário.")

    h.data_inicio = dt_inicio
    h.data_fim = dt_fim
    db.commit()
    db.refresh(h)
    return _serializar_horario(h, db)


@router.delete("/agendamentos/{agendamento_id}")
def deletar_agendamento(
    agendamento_id: int,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    h = db.query(models.HorarioEstudo).filter(models.HorarioEstudo.id == agendamento_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    dono_id = None
    if h.topico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).filter(
            models.Topico.id == h.topico_id
        ).scalar()
    elif h.subtopico_id:
        dono_id = db.query(models.PlanoEstudo.usuario_id).join(models.Materia).join(models.Topico).join(models.Subtopico).filter(
            models.Subtopico.id == h.subtopico_id
        ).scalar()

    if dono_id != usuario.id:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")

    db.delete(h)
    db.commit()
    return {"mensagem": "Agendamento deletado"}

# ==========================================================
# ANEXOS DE ATIVIDADE
# ==========================================================

@router.post("/atividades/{atividade_id}/anexos")
def upload_anexo_atividade(
    atividade_id: int,
    arquivo: UploadFile = File(...),
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    a = db.query(models.Atividade).filter(
        models.Atividade.id == atividade_id,
        models.Atividade.usuario_id == usuario.id
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")

    if not arquivo or not arquivo.filename:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado")

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

    anexo = models.AtividadeAnexo(
        atividade_id=atividade_id,
        nome_original=arquivo.filename,
        url_arquivo=f"/uploads/{nome_unico}",
    )
    db.add(anexo)
    db.commit()
    db.refresh(anexo)
    return {
        "id": anexo.id,
        "nome_original": anexo.nome_original,
        "url_arquivo": anexo.url_arquivo,
    }


@router.delete("/anexos/{anexo_id}")
def deletar_anexo(anexo_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    anexo = db.query(models.AtividadeAnexo).join(models.Atividade).filter(
        models.AtividadeAnexo.id == anexo_id,
        models.Atividade.usuario_id == usuario.id
    ).first()
    if not anexo:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")

    # Apaga o arquivo físico
    caminho = anexo.url_arquivo.lstrip("/")
    if os.path.exists(caminho):
        try:
            os.remove(caminho)
        except OSError:
            pass

    db.delete(anexo)
    db.commit()
    return {"mensagem": "Anexo deletado"}


# ==========================================================
# MARCAÇÕES (anotações em PDFs)
# ==========================================================

import json as _json

TIPOS_MARCACAO_VALIDOS = {"grifo", "retangulo", "seta", "bookmark", "nota"}


def _serializar_marcacao(m: models.Marcacao) -> dict:
    return {
        "id": m.id,
        "material_id": m.material_id,
        "tipo": m.tipo,
        "pagina": m.pagina,
        "cor": m.cor,
        "dados": m.dados,
        "criado_em": m.criado_em.isoformat() if m.criado_em else None,
    }


def _validar_material_do_usuario(material_id: int, usuario_id: int, db: Session):
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario_id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    return material


def _validar_json(dados_str: str):
    """Confere se 'dados' é um JSON válido. Salva como string."""
    try:
        _json.loads(dados_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Campo 'dados' deve ser um JSON válido")


@router.get("/materiais/{material_id}/marcacoes")
def listar_marcacoes(material_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    _validar_material_do_usuario(material_id, usuario.id, db)
    marcacoes = db.query(models.Marcacao).filter(
        models.Marcacao.material_id == material_id,
        models.Marcacao.usuario_id == usuario.id
    ).order_by(models.Marcacao.pagina.asc(), models.Marcacao.id.asc()).all()
    return [_serializar_marcacao(m) for m in marcacoes]


@router.post("/marcacoes")
def criar_marcacao(dados: schemas.MarcacaoCreate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    if dados.tipo not in TIPOS_MARCACAO_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {TIPOS_MARCACAO_VALIDOS}")
    if dados.pagina < 1:
        raise HTTPException(status_code=400, detail="Página deve ser >= 1")
    _validar_material_do_usuario(dados.material_id, usuario.id, db)
    _validar_json(dados.dados)

    m = models.Marcacao(
        usuario_id=usuario.id,
        material_id=dados.material_id,
        tipo=dados.tipo,
        pagina=dados.pagina,
        cor=dados.cor,
        dados=dados.dados,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _serializar_marcacao(m)


@router.patch("/marcacoes/{marcacao_id}")
def editar_marcacao(marcacao_id: int, dados: schemas.MarcacaoUpdate, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    m = db.query(models.Marcacao).filter(
        models.Marcacao.id == marcacao_id,
        models.Marcacao.usuario_id == usuario.id
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Marcação não encontrada")

    if dados.cor is not None:
        m.cor = dados.cor
    if dados.dados is not None:
        _validar_json(dados.dados)
        m.dados = dados.dados

    db.commit()
    db.refresh(m)
    return _serializar_marcacao(m)


@router.delete("/marcacoes/{marcacao_id}")
def deletar_marcacao(marcacao_id: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    m = db.query(models.Marcacao).filter(
        models.Marcacao.id == marcacao_id,
        models.Marcacao.usuario_id == usuario.id
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Marcação não encontrada")
    db.delete(m)
    db.commit()
    return {"mensagem": "Marcação deletada"}

@router.patch("/materiais/{material_id}/ultima-pagina")
def atualizar_ultima_pagina(
    material_id: int,
    dados: schemas.MaterialUltimaPaginaUpdate,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    if dados.ultima_pagina < 1:
        raise HTTPException(status_code=400, detail="Página deve ser >= 1")
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario.id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    material.ultima_pagina = dados.ultima_pagina
    db.commit()
    return {"id": material.id, "ultima_pagina": material.ultima_pagina}


# ==========================================================
# NOTAS POR PÁGINA (materiais)
# ==========================================================

@router.get("/materiais/{material_id}/notas/{pagina}")
def obter_nota_pagina(material_id: int, pagina: int, usuario=Depends(get_usuario_atual), db: Session = Depends(get_db)):
    if pagina < 1:
        raise HTTPException(status_code=400, detail="Página deve ser >= 1")
    # Valida dono do material
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario.id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    nota = db.query(models.MaterialNota).filter(
        models.MaterialNota.usuario_id == usuario.id,
        models.MaterialNota.material_id == material_id,
        models.MaterialNota.pagina == pagina
    ).first()

    if not nota:
        return {"material_id": material_id, "pagina": pagina, "texto": ""}

    return {
        "material_id": nota.material_id,
        "pagina": nota.pagina,
        "texto": nota.texto or "",
        "atualizado_em": nota.atualizado_em.isoformat() if nota.atualizado_em else None,
    }


@router.put("/materiais/{material_id}/notas/{pagina}")
def salvar_nota_pagina(
    material_id: int,
    pagina: int,
    dados: schemas.MaterialNotaUpdate,
    usuario=Depends(get_usuario_atual),
    db: Session = Depends(get_db),
):
    if pagina < 1:
        raise HTTPException(status_code=400, detail="Página deve ser >= 1")
    material = db.query(models.Material).filter(
        models.Material.id == material_id,
        models.Material.usuario_id == usuario.id
    ).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    nota = db.query(models.MaterialNota).filter(
        models.MaterialNota.usuario_id == usuario.id,
        models.MaterialNota.material_id == material_id,
        models.MaterialNota.pagina == pagina
    ).first()

    if not nota:
        nota = models.MaterialNota(
            usuario_id=usuario.id,
            material_id=material_id,
            pagina=pagina,
            texto=dados.texto,
        )
        db.add(nota)
    else:
        nota.texto = dados.texto

    db.commit()
    db.refresh(nota)
    return {
        "material_id": nota.material_id,
        "pagina": nota.pagina,
        "texto": nota.texto or "",
        "atualizado_em": nota.atualizado_em.isoformat() if nota.atualizado_em else None,
    }