// ==========================================
// Helpers de autenticação
// ==========================================

function getToken() {
    return localStorage.getItem('token');
}

function getUsuario() {
    const u = localStorage.getItem('usuario');
    return u ? JSON.parse(u) : null;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = '/index.html';
}

function protegerRota(roleEsperado) {
    const token = getToken();
    const usuario = getUsuario();

    if (!token || !usuario) {
        window.location.href = '/index.html';
        return null;
    }

    if (roleEsperado && usuario.role !== roleEsperado) {
        // Se não tem permissão, manda pra onde ele pertence
        window.location.href = usuario.role === 'admin' ? '/admin.html' : '/dashboard.html';
        return null;
    }

    return usuario;
}

// ==========================================
// Wrapper do fetch com JWT
// ==========================================

async function apiFetch(url, options = {}) {
    const token = getToken();

    const headers = options.headers || {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Se for FormData, deixa o browser definir Content-Type
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const resp = await fetch(url, { ...options, headers });

    if (resp.status === 401) {
        logout();
        return null;
    }

    if (resp.status === 204) {
        return null;
    }

    return resp;
}

// ==========================================
// Helpers de UI
// ==========================================

function mostrarToast(mensagem, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}