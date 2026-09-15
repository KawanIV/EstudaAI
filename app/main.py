import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine, SessionLocal
from . import models
from .auth import hash_senha
from .routers import auth_router, admin_router, estudos_router
from fastapi import Request

app = FastAPI(title="Kawan - Plataforma de Estudos")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(admin_router.router)
app.include_router(estudos_router.router)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/", StaticFiles(directory="static", html=True), name="static")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")

    admin_existente = db.query(models.Usuario).filter(models.Usuario.email == admin_email).first()
    if not admin_existente:
        admin = models.Usuario(
            nome="Administrador",
            email=admin_email,
            senha_hash=hash_senha(admin_password),
            role="admin",
        )
        db.add(admin)
        db.commit()
        print(f"✅ Admin criado: {admin_email}")
    db.close()

@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    # Não cacheia páginas HTML (mas deixa JS/CSS cachearem normalmente)
    if request.url.path.endswith(('.html', '/')) or '.' not in request.url.path.split('/')[-1]:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
    return response