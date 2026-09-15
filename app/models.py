from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, DateTime, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    senha_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="aluno")  # "aluno" ou "admin"
    licenca_ativa = Column(Boolean, default=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    planos = relationship("PlanoEstudo", back_populates="usuario", cascade="all, delete-orphan")
    acessos = relationship("MetricaAcesso", back_populates="usuario", cascade="all, delete-orphan")


class PlanoEstudo(Base):
    __tablename__ = "planos_estudo"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    nome = Column(String(150), nullable=False)
    descricao = Column(Text)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario", back_populates="planos")
    materias = relationship("Materia", back_populates="plano", cascade="all, delete-orphan")


class Materia(Base):
    __tablename__ = "materias"
    id = Column(Integer, primary_key=True, index=True)
    plano_id = Column(Integer, ForeignKey("planos_estudo.id"), nullable=False)
    nome = Column(String(150), nullable=False)
    ordem = Column(Integer, default=0)

    plano = relationship("PlanoEstudo", back_populates="materias")
    topicos = relationship("Topico", back_populates="materia", cascade="all, delete-orphan")


class Topico(Base):
    __tablename__ = "topicos"
    id = Column(Integer, primary_key=True, index=True)
    materia_id = Column(Integer, ForeignKey("materias.id"), nullable=False)
    numero = Column(String(20))
    nome = Column(String(150), nullable=False)
    ordem = Column(Integer, default=0)

    materia = relationship("Materia", back_populates="topicos")
    subtopicos = relationship("Subtopico", back_populates="topico", cascade="all, delete-orphan")


class Subtopico(Base):
    __tablename__ = "subtopicos"
    id = Column(Integer, primary_key=True, index=True)
    topico_id = Column(Integer, ForeignKey("topicos.id"), nullable=False)
    numero = Column(String(20))
    nome = Column(String(150), nullable=False)
    ordem = Column(Integer, default=0)

    topico = relationship("Topico", back_populates="subtopicos")
    conteudos = relationship("Conteudo", back_populates="subtopico", cascade="all, delete-orphan")
    perguntas = relationship("Pergunta", back_populates="subtopico", cascade="all, delete-orphan")


class Conteudo(Base):
    __tablename__ = "conteudos"
    id = Column(Integer, primary_key=True, index=True)
    subtopico_id = Column(Integer, ForeignKey("subtopicos.id"), nullable=False)
    tipo = Column(String(20), nullable=False)  # material, resumo, link, pdf
    titulo = Column(String(200))
    texto = Column(Text)
    url_arquivo = Column(String(500))
    url_link = Column(String(500))
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    subtopico = relationship("Subtopico", back_populates="conteudos")


class Pergunta(Base):
    __tablename__ = "perguntas"
    id = Column(Integer, primary_key=True, index=True)
    subtopico_id = Column(Integer, ForeignKey("subtopicos.id"), nullable=False)
    tipo = Column(String(30), nullable=False)  # multipla_escolha, v_f, dissertativa
    enunciado = Column(Text, nullable=False)
    opcoes = Column(Text)  # JSON em string
    resposta_correta = Column(Text)
    explicacao = Column(Text)

    subtopico = relationship("Subtopico", back_populates="perguntas")


class Progresso(Base):
    __tablename__ = "progresso"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    subtopico_id = Column(Integer, ForeignKey("subtopicos.id"), nullable=False)
    concluido = Column(Boolean, default=False)
    data_conclusao = Column(DateTime(timezone=True), onupdate=func.now())


class MetricaAcesso(Base):
    __tablename__ = "metricas_acesso"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    data_acesso = Column(DateTime(timezone=True), server_default=func.now())
    ip = Column(String(50))
    acao = Column(String(50))

    usuario = relationship("Usuario", back_populates="acessos")