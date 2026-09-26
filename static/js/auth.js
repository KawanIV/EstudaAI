// ==========================================
// AUTENTICAÇÃO
// ==========================================
function protegerRota(roleEsperado) {
    const token = localStorage.getItem('token');
    const usuario = localStorage.getItem('usuario');

    if (!token || !usuario) {
        window.location.href = '/index.html';
        return null;
    }

    const u = JSON.parse(usuario);

    if (roleEsperado && u.role !== roleEsperado) {
        window.location.href = u.role === 'admin' ? '/admin.html' : '/dashboard.html';
        return null;
    }

    return u;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = '/index.html';
}