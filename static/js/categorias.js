// ==========================================
// CATEGORIAS
// ==========================================
async function carregarCategorias() {
    const resp = await apiFetch('/api/estudos/categorias');
    if (!resp) return;
    CATEGORIAS = await resp.json();
    renderizarListaCategorias();
    renderizarListaCategoriasModal();
}

function renderizarListaCategorias() {
    const container = document.getElementById('lista-categorias');
    if (!container) return;
    container.innerHTML = CATEGORIAS.map(c => `
        <div class="cat-linha">
            <input type="text" value="${escapeAtributo(c.nome)}" data-id="${c.id}"
                onblur="salvarCategoriaInline(${c.id}, this.value)"
                onkeydown="if(event.key==='Enter') this.blur();">
            <button class="btn-acao excluir" onclick="excluirCategoria(${c.id})" title="Excluir">✕</button>
        </div>
    `).join('') || '<p style="color:#7f8c8d; font-size:0.9rem;">Nenhuma categoria ainda.</p>';
}

function renderizarListaCategoriasModal() {
    const container = document.getElementById('modal-categorias-lista');
    if (!container) return;
    container.innerHTML = CATEGORIAS.map(c => `
        <div class="cat-linha">
            <input type="text" value="${escapeAtributo(c.nome)}" data-id="${c.id}"
                onblur="salvarCategoriaInline(${c.id}, this.value)"
                onkeydown="if(event.key==='Enter') this.blur();">
            <button class="btn-acao excluir" onclick="excluirCategoria(${c.id})" title="Excluir">✕</button>
        </div>
    `).join('') || '<p style="color:#7f8c8d; font-size:0.9rem;">Nenhuma categoria ainda.</p>';
}

async function salvarCategoriaInline(id, novoNome) {
    const nome = (novoNome || '').trim();
    if (!nome) { await carregarCategorias(); return; }
    const atual = CATEGORIAS.find(c => c.id === id);
    if (atual && atual.nome === nome) return;
    const resp = await apiFetch(`/api/estudos/categorias/${id}`, {
        method: 'PATCH', body: JSON.stringify({ nome })
    });
    if (resp && resp.ok) {
        mostrarToast('Categoria atualizada', 'success');
        await carregarCategorias();
        await carregarArvore();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
        await carregarCategorias();
    }
}

async function adicionarCategoriaVazia() {
    const resp = await apiFetch('/api/estudos/categorias', {
        method: 'POST', body: JSON.stringify({ nome: 'Nova categoria' })
    });
    if (resp && resp.ok) {
        await carregarCategorias();
        setTimeout(() => {
            const inputs = document.querySelectorAll('.cat-linha input');
            if (inputs.length) { const u = inputs[inputs.length - 1]; u.focus(); u.select(); }
        }, 100);
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

async function excluirCategoria(id) {
    if (!confirm('Excluir esta categoria? Os itens que usam ela vão ficar sem categoria.')) return;
    const resp = await apiFetch(`/api/estudos/categorias/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Categoria excluída', 'success');
        await carregarCategorias();
        await carregarArvore();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

function abrirModalCategorias() {
    renderizarListaCategoriasModal();
    document.getElementById('modal-categorias').style.display = 'flex';
}

function fecharModalCategorias() {
    document.getElementById('modal-categorias').style.display = 'none';
    renderizarListaCategorias();
    if (CATEGORIA_VOLTAR_PARA_MODAL) {
        const selectCriar = document.getElementById('campo-categoria');
        if (selectCriar) selectCriar.innerHTML = optionsCategorias(selectCriar.value);
        const selectEditar = document.getElementById('edit-categoria');
        if (selectEditar) selectEditar.innerHTML = optionsCategorias(selectEditar.value);
        if (CATEGORIAS.length) {
            const ultima = CATEGORIAS[CATEGORIAS.length - 1];
            if (selectCriar) selectCriar.value = ultima.id;
            if (selectEditar) selectEditar.value = ultima.id;
        }
        CATEGORIA_VOLTAR_PARA_MODAL = false;
    }
}

// Helper usado nos modais (criar/editar item)
function optionsCategorias(selecionadoId) {
    let html = `<option value="">— Sem categoria —</option>`;
    CATEGORIAS.forEach(c => {
        const sel = (String(c.id) === String(selecionadoId)) ? 'selected' : '';
        html += `<option value="${c.id}" ${sel}>${escapeHtml(c.nome)}</option>`;
    });
    html += `<option value="__nova__">➕ Criar nova categoria</option>`;
    return html;
}

function onCategoriaChange(e) {
    if (e.target.value === '__nova__') {
        e.target.value = '';
        CATEGORIA_VOLTAR_PARA_MODAL = true;
        abrirModalCategorias();
    }
}