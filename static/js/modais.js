// ==========================================
// MODAIS - criação e edição de itens da árvore
// ==========================================
function criarPlano() { abrirCriacao('plano', null); }

function abrirCriacao(tipo, paiId) {
    TIPO_CRIACAO = tipo;
    CONTEXTO_CRIACAO = paiId;
    const titulos = {
        plano: 'Novo Plano de Estudos', materia: 'Nova Matéria',
        topico: 'Novo Tópico', subtopico: 'Novo Subtópico'
    };
    document.getElementById('modal-titulo').innerText = titulos[tipo];
    let campos = '';
    if (tipo === 'plano') {
        campos = `<label>Nome</label><input type="text" id="campo-nome" placeholder="Ex: Engenharia Elétrica" required>
                  <label>Descrição</label><textarea id="campo-descricao" placeholder="Opcional"></textarea>`;
    } else if (tipo === 'materia') {
        campos = `<label>Nome</label><input type="text" id="campo-nome" placeholder="Ex: Cálculo I" required>`;
    } else {
        campos = `<label>Número</label><input type="text" id="campo-numero" placeholder="Ex: 1 ou 1.1">
                  <label>Nome</label><input type="text" id="campo-nome" placeholder="Nome" required>`;
    }
    campos += `<label>Categoria</label><select id="campo-categoria">${optionsCategorias('')}</select>`;
    document.getElementById('modal-campos').innerHTML = campos;
    document.getElementById('campo-categoria').addEventListener('change', onCategoriaChange);
    document.getElementById('modal').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modal').style.display = 'none';
    TIPO_CRIACAO = null;
    CONTEXTO_CRIACAO = null;
}

async function confirmarModal() {
    const nome = document.getElementById('campo-nome')?.value.trim();
    const descricao = document.getElementById('campo-descricao')?.value.trim();
    const numero = document.getElementById('campo-numero')?.value.trim();
    const catId = document.getElementById('campo-categoria')?.value;
    const categoria_id = catId && catId !== '__nova__' ? parseInt(catId) : null;
    if (!nome) { mostrarToast('Preencha o nome', 'error'); return; }
    const eraNovoPlano = TIPO_CRIACAO === 'plano';
    let url, body;
    if (TIPO_CRIACAO === 'plano') { url = '/api/estudos/planos'; body = { nome, descricao: descricao || null, categoria_id }; }
    else if (TIPO_CRIACAO === 'materia') { url = `/api/estudos/planos/${CONTEXTO_CRIACAO}/materias`; body = { nome, categoria_id }; }
    else if (TIPO_CRIACAO === 'topico') { url = `/api/estudos/materias/${CONTEXTO_CRIACAO}/topicos`; body = { nome, numero: numero || null, categoria_id }; }
    else if (TIPO_CRIACAO === 'subtopico') { url = `/api/estudos/topicos/${CONTEXTO_CRIACAO}/subtopicos`; body = { nome, numero: numero || null, categoria_id }; }
    const resp = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (resp && resp.ok) {
        const criado = await resp.json();
        mostrarToast('Criado!', 'success');
        fecharModal();
        await carregarArvore();
        if (eraNovoPlano && criado && criado.id) {
            NOS_EXPANDIDOS.add(`plano-${criado.id}`);
            selecionarPlano(criado.id);
        }
        if (TIPO_CRIACAO === 'subtopico' && NO_ATUAL && NO_ATUAL.tipo === 'topico') {
            const topAtual = encontrarNo('topico', NO_ATUAL.id);
            if (topAtual) { NO_ATUAL.ref = topAtual; renderizarTabSubtopicos(topAtual); }
        }
    } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
}

// ==========================================
// EDIÇÃO DE ITEM DA ÁRVORE
// ==========================================
function editarItem(recurso, id) {
    const item = buscarItem(recurso, id);
    if (!item) return;
    EDITANDO = { recurso, id };
    const tipo = recurso === 'planos' ? 'plano' : (recurso === 'materias' ? 'matéria' : (recurso === 'topicos' ? 'tópico' : 'subtópico'));
    document.getElementById('modal-editar-titulo').innerText = `Editar ${tipo}`;
    let campos = '';
    if (recurso === 'planos') {
        campos = `<label>Nome</label><input type="text" id="edit-nome" value="${escapeAtributo(item.nome)}">
                  <label>Descrição</label><textarea id="edit-descricao">${escapeHtml(item.descricao || '')}</textarea>`;
    } else if (recurso === 'materias') {
        campos = `<label>Nome</label><input type="text" id="edit-nome" value="${escapeAtributo(item.nome)}">`;
    } else {
        campos = `<label>Número</label><input type="text" id="edit-numero" value="${escapeAtributo(item.numero || '')}">
                  <label>Nome</label><input type="text" id="edit-nome" value="${escapeAtributo(item.nome)}">`;
    }
    const catId = item.categoria ? item.categoria.id : '';
    campos += `<label>Categoria</label><select id="edit-categoria">${optionsCategorias(catId)}</select>`;
    document.getElementById('modal-editar-campos').innerHTML = campos;
    document.getElementById('edit-categoria').addEventListener('change', onCategoriaChange);
    document.getElementById('modal-editar').style.display = 'flex';
}

function fecharModalEditar() {
    document.getElementById('modal-editar').style.display = 'none';
    EDITANDO = null;
}

async function confirmarModalEditar() {
    if (!EDITANDO) return;
    const { recurso, id } = EDITANDO;
    const nome = document.getElementById('edit-nome')?.value.trim();
    const numero = document.getElementById('edit-numero')?.value.trim();
    const descricao = document.getElementById('edit-descricao')?.value.trim();
    const catId = document.getElementById('edit-categoria')?.value;
    const categoria_id = catId ? parseInt(catId) : null;
    if (!nome) { mostrarToast('Nome obrigatório', 'error'); return; }
    const body = { nome, categoria_id };
    if (numero !== undefined) body.numero = numero || null;
    if (descricao !== undefined) body.descricao = descricao || null;
    const resp = await apiFetch(`/api/estudos/${recurso}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (resp && resp.ok) {
        mostrarToast('Salvo!', 'success');
        fecharModalEditar();
        await carregarArvore();
    } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
}

function buscarItem(recurso, id) {
    if (recurso === 'planos') return ARVORE.find(p => p.id === id);
    for (const p of ARVORE)
        for (const m of p.materias) {
            if (recurso === 'materias' && m.id === id) return m;
            for (const t of m.topicos) {
                if (recurso === 'topicos' && t.id === id) return t;
                for (const s of t.subtopicos) {
                    if (recurso === 'subtopicos' && s.id === id) return s;
                }
            }
        }
    return null;
}