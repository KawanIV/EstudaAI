// ==========================================
// MATERIAIS (lista global)
// ==========================================
async function carregarMateriais() {
    const resp = await apiFetch('/api/estudos/materiais');
    if (!resp) return;
    MATERIAIS = await resp.json();
    if (MODO === 'materiais') renderizarTabelaMateriais();
}

async function carregarTiposMaterial() {
    const resp = await apiFetch('/api/estudos/tipos-material');
    if (!resp) return;
    TIPOS_MATERIAL = await resp.json();
    renderizarListaTiposModal();
}

function toggleFiltros() {
    document.getElementById('btn-filtros').classList.toggle('ativo');
    renderizarTabelaMateriais();
}
function filtrosVisiveis() {
    return document.getElementById('btn-filtros').classList.contains('ativo');
}
function ordenarPor(campo) {
    if (MATERIAIS_ORDEM.campo === campo) {
        MATERIAIS_ORDEM.direcao = MATERIAIS_ORDEM.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        MATERIAIS_ORDEM.campo = campo;
        MATERIAIS_ORDEM.direcao = 'asc';
    }
    renderizarTabelaMateriais();
}
function atualizarSeta(campo) {
    const mapId = { nome: 'nome', materia_nome: 'materia', tipo_nome: 'tipo', url_link: 'link', url_arquivo: 'arquivo', criado_em: 'nome' };
    const th = document.getElementById(`th-${mapId[campo] || 'nome'}`);
    if (!th) return;
    document.querySelectorAll('.tabela-materiais thead th').forEach(t => t.classList.remove('ordenado'));
    th.classList.add('ordenado');
    th.querySelector('.seta').innerText = MATERIAIS_ORDEM.direcao === 'asc' ? '▲' : '▼';
}
function materialBateFiltro(m) {
    const f = MATERIAIS_FILTROS;
    if (f.nome && !(m.nome || '').toLowerCase().includes(f.nome.toLowerCase())) return false;
    if (f.materia_nome && !(m.materia_nome || '').toLowerCase().includes(f.materia_nome.toLowerCase())) return false;
    if (f.tipo_nome && !(m.tipo_nome || '').toLowerCase().includes(f.tipo_nome.toLowerCase())) return false;
    if (f.url_link && !(m.url_link || '').toLowerCase().includes(f.url_link.toLowerCase())) return false;
    if (f.url_arquivo && !(m.url_arquivo || '').toLowerCase().includes(f.url_arquivo.toLowerCase())) return false;
    return true;
}
function renderizarTabelaMateriais() {
    const tbody = document.getElementById('tbody-materiais');
    if (!tbody) return;
    atualizarSeta(MATERIAIS_ORDEM.campo);
    const visiveis = MATERIAIS.filter(materialBateFiltro);
    visiveis.sort((a, b) => {
        const campo = MATERIAIS_ORDEM.campo;
        let va = a[campo] || '';
        let vb = b[campo] || '';
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return MATERIAIS_ORDEM.direcao === 'asc' ? -1 : 1;
        if (va > vb) return MATERIAIS_ORDEM.direcao === 'asc' ? 1 : -1;
        return 0;
    });
    let html = '';
    if (filtrosVisiveis()) {
        html += `<tr class="linha-filtros ativa">
            <td><input placeholder="Filtrar nome..." value="${escapeAtributo(MATERIAIS_FILTROS.nome)}" oninput="setFiltro('nome', this.value)"></td>
            <td><input placeholder="Filtrar matéria..." value="${escapeAtributo(MATERIAIS_FILTROS.materia_nome)}" oninput="setFiltro('materia_nome', this.value)"></td>
            <td><input placeholder="Filtrar tipo..." value="${escapeAtributo(MATERIAIS_FILTROS.tipo_nome)}" oninput="setFiltro('tipo_nome', this.value)"></td>
            <td><input placeholder="Filtrar link..." value="${escapeAtributo(MATERIAIS_FILTROS.url_link)}" oninput="setFiltro('url_link', this.value)"></td>
            <td><input placeholder="Filtrar arquivo..." value="${escapeAtributo(MATERIAIS_FILTROS.url_arquivo)}" oninput="setFiltro('url_arquivo', this.value)"></td>
            <td></td>
        </tr>`;
    }
    if (!visiveis.length) {
        html += `<tr><td colspan="6" class="vazio-tabela">Nenhum material ${MATERIAIS.length ? 'com esse filtro' : 'ainda'}.</td></tr>`;
    } else {
        visiveis.forEach(m => {
            const linkCell = m.url_link
                ? `<a href="${escapeHtml(m.url_link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔗 Abrir</a>`
                : '<span style="color:#bdc3c7;">—</span>';
            const arqCell = m.url_arquivo
                ? `<a href="${escapeHtml(m.url_arquivo)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎 Baixar</a>`
                : '<span style="color:#bdc3c7;">—</span>';
            const matCell = m.materia_nome
                ? `<span class="badge-materia">${escapeHtml(m.materia_nome)}</span>`
                : '<span style="color:#bdc3c7;">—</span>';
            const tipoCell = m.tipo_nome
                ? `<span class="badge-tipo">${escapeHtml(m.tipo_nome)}</span>`
                : '<span style="color:#bdc3c7;">—</span>';
            html += `<tr onclick="abrirMaterial(${m.id})">
                <td class="col-nome">${escapeHtml(m.nome)}</td>
                <td>${matCell}</td>
                <td>${tipoCell}</td>
                <td class="col-link">${linkCell}</td>
                <td class="col-arquivo">${arqCell}</td>
                <td class="col-acoes">
                    <button onclick="event.stopPropagation(); abrirEdicaoMaterial(${m.id})" title="Editar">✏️</button>
                    <button class="excluir" onclick="event.stopPropagation(); excluirMaterial(${m.id})" title="Excluir">✕</button>
                </td>
            </tr>`;
        });
    }
    tbody.innerHTML = html;
}
function setFiltro(campo, valor) {
    MATERIAIS_FILTROS[campo] = valor;
    renderizarTabelaMateriais();
    setTimeout(() => {
        const inputs = document.querySelectorAll('.linha-filtros input');
        const index = { nome: 0, materia_nome: 1, tipo_nome: 2, url_link: 3, url_arquivo: 4 }[campo];
        if (inputs[index]) {
            inputs[index].focus();
            inputs[index].setSelectionRange(inputs[index].value.length, inputs[index].value.length);
        }
    }, 0);
}
function abrirMaterial(id) {
    const m = MATERIAIS.find(x => x.id === id);
    if (!m) return;

    // Se tiver arquivo, tenta abrir no leitor interno
    if (m.url_arquivo) {
        const ext = (m.url_arquivo.split('.').pop() || '').toLowerCase();
        if (ext === 'pdf') {
            abrirLeitor(id);
            return;
        }
        // Não é PDF — abre em nova aba
        window.open(m.url_arquivo, '_blank');
        return;
    }
    // Sem arquivo, mas tem link
    if (m.url_link) window.open(m.url_link, '_blank');
}
function abrirCriacaoMaterial() {
    MATERIAIS_EDITANDO = null;
    document.getElementById('modal-material-titulo').innerText = 'Novo Material';
    renderizarFormMaterial(null);
    document.getElementById('modal-material').style.display = 'flex';
}
function abrirEdicaoMaterial(id) {
    const m = MATERIAIS.find(x => x.id === id);
    if (!m) return;
    MATERIAIS_EDITANDO = id;
    document.getElementById('modal-material-titulo').innerText = 'Editar Material';
    renderizarFormMaterial(m);
    document.getElementById('modal-material').style.display = 'flex';
}
function renderizarFormMaterial(m) {
    let campos = `<label>Nome</label><input type="text" id="mat-nome" value="${m ? escapeAtributo(m.nome) : ''}" placeholder="Ex: Clean Code" required>`;
    campos += `<label>Matéria (opcional)</label><select id="mat-materia">${optionsMaterias(m ? m.materia_id : null)}</select>`;
    campos += `<label>Tipo (opcional)</label><select id="mat-tipo">${optionsTipos(m ? m.tipo_id : null)}</select>`;
    campos += `<label>Link (opcional)</label><input type="url" id="mat-link" value="${m && m.url_link ? escapeAtributo(m.url_link) : ''}" placeholder="https://...">`;
    campos += `<label>Arquivo (opcional)</label><input type="file" id="mat-arquivo" accept=".pdf,.docx,.doc,.txt,.md,.odt,.rtf,.csv,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.py,.ipynb,.js,.ts,.html,.css,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.tex,.epub,.mp3,.mp4,.mov,.wav">`;
    if (m && m.url_arquivo) {
        campos += `<p style="font-size:0.8rem; color:#7f8c8d; margin-top:6px;">Arquivo atual: <a href="${escapeHtml(m.url_arquivo)}" target="_blank" rel="noopener">📎 abrir</a> (enviar novo substitui)</p>`;
    }
    document.getElementById('modal-material-campos').innerHTML = campos;
    const selTipo = document.getElementById('mat-tipo');
    if (selTipo) selTipo.addEventListener('change', onTipoChange);
}
function optionsMaterias(selecionadaId) {
    let html = `<option value="">— Sem matéria —</option>`;
    ARVORE.forEach(plano => {
        plano.materias.forEach(mat => {
            const sel = (String(mat.id) === String(selecionadaId)) ? 'selected' : '';
            html += `<option value="${mat.id}" ${sel}>${escapeHtml(plano.nome)} › ${escapeHtml(mat.nome)}</option>`;
        });
    });
    return html;
}
function optionsTipos(selecionadoId) {
    let html = `<option value="">— Sem tipo —</option>`;
    TIPOS_MATERIAL.forEach(t => {
        const sel = (String(t.id) === String(selecionadoId)) ? 'selected' : '';
        html += `<option value="${t.id}" ${sel}>${escapeHtml(t.nome)}</option>`;
    });
    html += `<option value="__novo__">➕ Criar novo tipo</option>`;
    return html;
}
function onTipoChange(e) {
    if (e.target.value === '__novo__') {
        e.target.value = '';
        TIPO_VOLTAR_PARA_MODAL = true;
        abrirModalTipos();
    }
}
function fecharModalMaterial() {
    document.getElementById('modal-material').style.display = 'none';
    MATERIAIS_EDITANDO = null;
}
async function confirmarModalMaterial() {
    const nome = document.getElementById('mat-nome').value.trim();
    const materiaId = document.getElementById('mat-materia').value;
    const tipoId = document.getElementById('mat-tipo').value;
    const link = document.getElementById('mat-link').value.trim();
    const arquivo = document.getElementById('mat-arquivo').files[0];
    if (!nome) { mostrarToast('Nome obrigatório', 'error'); return; }
    const fd = new FormData();
    fd.append('nome', nome);
    fd.append('materia_id', materiaId || '');
    fd.append('tipo_id', tipoId || '');
    if (link) fd.append('url_link', link);
    if (arquivo) fd.append('arquivo', arquivo);
    let resp;
    if (MATERIAIS_EDITANDO) {
        resp = await apiFetch(`/api/estudos/materiais/${MATERIAIS_EDITANDO}`, { method: 'PATCH', body: fd });
    } else {
        resp = await apiFetch('/api/estudos/materiais', { method: 'POST', body: fd });
    }
    if (resp && resp.ok) {
        mostrarToast(MATERIAIS_EDITANDO ? 'Material salvo!' : 'Material criado!', 'success');
        fecharModalMaterial();
        await carregarMateriais();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}
async function excluirMaterial(id) {
    if (!confirm('Excluir este material? O arquivo também será removido.')) return;
    const resp = await apiFetch(`/api/estudos/materiais/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Material excluído', 'success');
        await carregarMateriais();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

// ==========================================
// TIPOS DE MATERIAL
// ==========================================
function abrirModalTipos() {
    renderizarListaTiposModal();
    document.getElementById('modal-tipos').style.display = 'flex';
}
function fecharModalTipos() {
    document.getElementById('modal-tipos').style.display = 'none';
    if (TIPO_VOLTAR_PARA_MODAL) {
        const selTipo = document.getElementById('mat-tipo');
        if (selTipo) {
            const valorAtual = selTipo.value;
            selTipo.innerHTML = optionsTipos(valorAtual);
            if (TIPOS_MATERIAL.length) {
                selTipo.value = TIPOS_MATERIAL[TIPOS_MATERIAL.length - 1].id;
            }
        }
        TIPO_VOLTAR_PARA_MODAL = false;
    }
}
function renderizarListaTiposModal() {
    const container = document.getElementById('modal-tipos-lista');
    if (!container) return;
    container.innerHTML = TIPOS_MATERIAL.map(t => `
        <div class="cat-linha">
            <input type="text" value="${escapeAtributo(t.nome)}" data-id="${t.id}"
                onblur="salvarTipoInline(${t.id}, this.value)"
                onkeydown="if(event.key==='Enter') this.blur();">
            <button class="btn-acao excluir" onclick="excluirTipo(${t.id})" title="Excluir">✕</button>
        </div>
    `).join('') || '<p style="color:#7f8c8d; font-size:0.9rem;">Nenhum tipo ainda.</p>';
}
async function salvarTipoInline(id, novoNome) {
    const nome = (novoNome || '').trim();
    if (!nome) { await carregarTiposMaterial(); return; }
    const atual = TIPOS_MATERIAL.find(t => t.id === id);
    if (atual && atual.nome === nome) return;
    const resp = await apiFetch(`/api/estudos/tipos-material/${id}`, {
        method: 'PATCH', body: JSON.stringify({ nome })
    });
    if (resp && resp.ok) {
        mostrarToast('Tipo atualizado', 'success');
        await carregarTiposMaterial();
        await carregarMateriais();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
        await carregarTiposMaterial();
    }
}
async function adicionarTipoVazio() {
    const resp = await apiFetch('/api/estudos/tipos-material', {
        method: 'POST', body: JSON.stringify({ nome: 'Novo tipo' })
    });
    if (resp && resp.ok) {
        await carregarTiposMaterial();
        setTimeout(() => {
            const inputs = document.querySelectorAll('#modal-tipos-lista input');
            if (inputs.length) { const u = inputs[inputs.length - 1]; u.focus(); u.select(); }
        }, 100);
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}
async function excluirTipo(id) {
    if (!confirm('Excluir este tipo? Os materiais que usam ele vão ficar sem tipo.')) return;
    const resp = await apiFetch(`/api/estudos/tipos-material/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Tipo excluído', 'success');
        await carregarTiposMaterial();
        await carregarMateriais();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}