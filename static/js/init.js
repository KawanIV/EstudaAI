// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    USUARIO = protegerRota('aluno');
    if (!USUARIO) return;

    const contaNome = document.getElementById('conta-nome');
    const contaEmail = document.getElementById('conta-email');
    if (contaNome) contaNome.innerText = USUARIO.nome;
    if (contaEmail) contaEmail.innerText = USUARIO.email;

    await carregarCategorias();
    await carregarTiposMaterial();
    await carregarTiposAtividade();
    await carregarArvore();
    await carregarMateriais();
    await carregarAtividades();

    document.addEventListener('click', () => fecharDropdown());
});

window.addEventListener('resize', () => {
    if (MODO === 'mapa') {
        const svgEl = document.getElementById('mapa-svg');
        if (svgEl.style.display !== 'none') {
            clearTimeout(window.__resizeTimer);
            window.__resizeTimer = setTimeout(() => renderizarMapa(), 200);
        }
    }
});