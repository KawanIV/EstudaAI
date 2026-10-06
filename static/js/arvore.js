// ==========================================
// ÁRVORE - carregar, lista, selecionar
// ==========================================
async function carregarArvore() {
    const resp = await apiFetch('/api/estudos/arvore');
    if (!resp) return;
    ARVORE = await resp.json();

    if (PLANO_ATUAL) {
        const atualizado = ARVORE.find(p => p.id === PLANO_ATUAL.id);
        if (atualizado) {
            PLANO_ATUAL = atualizado;
            if (NO_ATUAL) {
                const noAtualizado = encontrarNo(NO_ATUAL.tipo, NO_ATUAL.id);
                if (noAtualizado) {
                    NO_ATUAL = { tipo: NO_ATUAL.tipo, id: NO_ATUAL.id, ref: noAtualizado };
                    renderizarConteudoDoNo();
                }
            }
        } else {
            PLANO_ATUAL = null;
            NO_ATUAL = null;
        }
    }

    renderizarModoAtual();
}

// ==========================================
// LISTA (modo lista)
// ==========================================
function renderizarLista() {
    const container = document.getElementById('lista-container');
    let html = '';
    ARVORE.forEach(plano => { html += construirHtmlListaPlano(plano); });
    if (!html) html = '<p style="text-align:center; color:#7f8c8d; margin-top:60px;">Nenhum plano ainda.</p>';
    container.innerHTML = html;
}

function construirHtmlListaPlano(plano) {
    const noAtual = NO_ATUAL;
    let html = `<div class="lista-plano">
        <div class="lista-item">
            <span class="status-pill ${plano.status}">${plano.porcentagem}%</span>
            <span class="nome-flex" onclick="selecionarPlano(${plano.id})">🗺️ ${escapeHtml(plano.nome)}</span>
            ${badgeCat(plano.categoria)}
            <button class="btn-edit-small" onclick="editarItem('planos', ${plano.id})" title="Editar">✏️</button>
            <button class="btn-add-small" onclick="abrirCriacao('materia', ${plano.id})" title="Nova matéria">+</button>
            <button class="btn-del" onclick="deletarItem('planos', ${plano.id})" title="Excluir plano">✕</button>
        </div>`;
    plano.materias.forEach(mat => {
        html += `<div class="lista-materia">
            <div class="lista-item">
                <span class="status-pill ${mat.status}">${mat.porcentagem}%</span>
                <span class="nome-flex">📂 ${escapeHtml(mat.nome)}</span>
                ${badgeCat(mat.categoria)}
                <button class="btn-edit-small" onclick="editarItem('materias', ${mat.id})" title="Editar">✏️</button>
                <button class="btn-add-small" onclick="abrirCriacao('topico', ${mat.id})" title="Novo tópico">+</button>
                <button class="btn-del" onclick="deletarItem('materias', ${mat.id})" title="Excluir matéria">✕</button>
            </div>`;
        mat.topicos.forEach(top => {
            const nomeTop = `${top.numero || ''} ${top.nome}`.trim();
            const ativoTop = noAtual && noAtual.tipo === 'topico' && noAtual.id === top.id ? 'ativo' : '';
            html += `<div class="lista-topico">
                <div class="lista-item ${ativoTop}" onclick="selecionarNo('topico', ${top.id})">
                    <span class="status-pill ${top.status}">${top.porcentagem}%</span>
                    <span class="nome-flex">🔖 ${escapeHtml(nomeTop)}</span>
                    ${badgeCat(top.categoria)}
                    <button class="btn-edit-small" onclick="event.stopPropagation(); editarItem('topicos', ${top.id})" title="Editar">✏️</button>
                    <button class="btn-menu-small" onclick="event.stopPropagation(); abrirDropdown(event, 'topico', ${top.id}, '${top.status || 'adicionado'}')" title="Mais opções">⋯</button>
                    <button class="btn-add-small" onclick="event.stopPropagation(); abrirCriacao('subtopico', ${top.id})" title="Novo subtópico">+</button>
                </div>`;
            top.subtopicos.forEach(sub => {
                const nomeSub = `${sub.numero || ''} ${sub.nome}`.trim();
                const ativoSub = noAtual && noAtual.tipo === 'subtopico' && noAtual.id === sub.id ? 'ativo' : '';
                html += `<div class="lista-subtopico">
                    <div class="lista-item ${ativoSub}" onclick="selecionarNo('subtopico', ${sub.id})">
                        <span class="status-pill ${sub.status}">${sub.porcentagem}%</span>
                        <span class="nome-flex">📄 ${escapeHtml(nomeSub)}</span>
                        ${badgeCat(sub.categoria)}
                        <button class="btn-edit-small" onclick="event.stopPropagation(); editarItem('subtopicos', ${sub.id})" title="Editar">✏️</button>
                        <button class="btn-menu-small" onclick="event.stopPropagation(); abrirDropdown(event, 'subtopico', ${sub.id}, '${sub.status || 'adicionado'}')" title="Mais opções">⋯</button>
                    </div>
                </div>`;
            });
            html += `</div>`;
        });
        html += `</div>`;
    });
    html += `</div>`;
    return html;
}

function badgeCat(cat) {
    if (!cat) return '';
    return `<span class="badge-categoria">${escapeHtml(cat.nome)}</span>`;
}

// ==========================================
// SELECIONAR
// ==========================================
function selecionarPlano(planoId) {
    const plano = ARVORE.find(p => p.id === planoId);
    if (!plano) return;

    // Se está trocando de plano, limpa o estado de expansão
    if (!PLANO_ATUAL || PLANO_ATUAL.id !== planoId) {
        NOS_EXPANDIDOS.clear();
    }

    PLANO_ATUAL = plano;
    NO_ATUAL = null;
    document.getElementById('bem-vindo-conteudo').style.display = 'block';
    document.getElementById('conteudo-area').style.display = 'none';
    if (MODO === 'conta' || MODO === 'materiais' || MODO === 'agenda' || MODO === 'atividades') mudarModo('mapa');
    else renderizarModoAtual();
}
function selecionarNo(tipo, id) {
    const ref = encontrarNo(tipo, id);
    if (!ref) return;
    NO_ATUAL = { tipo, id, ref };
    renderizarConteudoDoNo();
    if (MODO === 'lista') renderizarLista();
    if (MODO === 'mapa') atualizarSelecaoVisual();
}

function encontrarNo(tipo, id) {
    for (const plano of ARVORE)
        for (const mat of plano.materias)
            for (const top of mat.topicos) {
                if (tipo === 'topico' && top.id === id) return top;
                for (const sub of top.subtopicos) {
                    if (tipo === 'subtopico' && sub.id === id) return sub;
                }
            }
    return null;
}

function encontrarNoMateria(id) {
    for (const plano of ARVORE)
        for (const mat of plano.materias)
            if (mat.id === id) return mat;
    return null;
}