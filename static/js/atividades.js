// ==========================================
// ATIVIDADES
// ==========================================
async function carregarTiposAtividade() {
    const resp = await apiFetch('/api/estudos/tipos-atividade');
    if (!resp) return;
    TIPOS_ATIVIDADE = await resp.json();
    renderizarListaTiposAtividadeModal();
}

async function carregarAtividades() {
    const resp = await apiFetch('/api/estudos/atividades');
    if (!resp) return;
    ATIVIDADES = await resp.json();
    if (NO_ATUAL && (NO_ATUAL.tipo === 'materia' || NO_ATUAL.tipo === 'topico' || NO_ATUAL.tipo === 'subtopico')) {
        renderizarTabAtividades(NO_ATUAL.ref, NO_ATUAL.tipo);
    }
}

function atividadesDoNo(tipo, id) {
    return ATIVIDADES.filter(a => {
        if (tipo === 'materia') return a.materia_id === id;
        if (tipo === 'topico') return a.topico_id === id;
        if (tipo === 'subtopico') return a.subtopico_id === id;
        return false;
    });
}

function renderizarTabAtividades(no, tipo) {
    const container = document.getElementById('tab-atividades');
    if (!container) return;

    const atividades = atividadesDoNo(tipo, no.id);
    let html = '';

    if (!atividades.length) {
        html = `<div class="atividades-vazia">📭 Nenhuma atividade vinculada ainda.</div>`;
    } else {
        atividades.forEach(a => {
            const classeStatus = `status-${a.status}`;
            const dataFormatada = a.data_entrega
                ? new Date(a.data_entrega).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : 'Sem data';
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const atrasada = a.data_entrega && a.status !== 'feito' && new Date(a.data_entrega) < hoje;
            const statusLabels = { pendente: '⚪ Pendente', em_andamento: '🟡 Em andamento', feito: '🟢 Feito' };

            html += `<div class="atividade-card ${classeStatus}">
                <div class="info">
                    <div class="nome">${escapeHtml(a.nome)}</div>
                    <div class="meta">
                        ${a.tipo ? `<span class="tipo">${escapeHtml(a.tipo.nome)}</span>` : ''}
                        <span class="data ${atrasada ? 'atrasada' : ''}">📅 ${dataFormatada}${atrasada ? ' (atrasada)' : ''}</span>
                        <span class="status-badge ${classeStatus}">${statusLabels[a.status] || a.status}</span>
                    </div>
                    ${a.descricao ? `<div class="descricao">${renderizarMarkdown(a.descricao)}</div>` : ''}
                    ${a.anexos && a.anexos.length ? `<div class="anexos-lista" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px;">${a.anexos.map(an => `<a href="${escapeHtml(an.url_arquivo)}" target="_blank" rel="noopener" class="badge-anexo" title="${escapeAtributo(an.nome_original)}">📎 ${escapeHtml(truncar(an.nome_original, 30))}</a>`).join('')}</div>` : ''}
                </div>
                <div class="acoes">
                    <button onclick="editarAtividade(${a.id})" title="Editar">✏️</button>
                    <button class="excluir" onclick="excluirAtividade(${a.id})" title="Excluir">✕</button>
                </div>
            </div>`;
        });
    }

    html += `<button class="tab-add-btn" onclick="abrirCriacaoAtividadeDoNo()">+ Nova atividade</button>`;
    container.innerHTML = html;
}

function optionsTiposAtividade(selecionadoId) {
    let html = `<option value="">— Sem tipo —</option>`;
    TIPOS_ATIVIDADE.forEach(t => {
        const sel = (String(t.id) === String(selecionadoId)) ? 'selected' : '';
        html += `<option value="${t.id}" ${sel}>${escapeHtml(t.nome)}</option>`;
    });
    html += `<option value="__novo__">➕ Criar novo tipo</option>`;
    return html;
}

function optionsVinculoAtividade(vinculo) {
    let html = `<option value="">— Sem vínculo —</option>`;
    ARVORE.forEach(plano => {
        const selPlano = vinculo.plano_id === plano.id ? 'selected' : '';
        html += `<optgroup label="🗺️ ${escapeAtributo(plano.nome)}">`;
        html += `<option value="plano:${plano.id}" ${selPlano}>  ↳ Plano inteiro</option>`;
        plano.materias.forEach(mat => {
            const selMat = vinculo.materia_id === mat.id ? 'selected' : '';
            html += `<option value="materia:${mat.id}" ${selMat}>  ↳ 📂 ${escapeHtml(mat.nome)}</option>`;
            mat.topicos.forEach(top => {
                const nomeTop = `${top.numero || ''} ${top.nome}`.trim();
                const selTop = vinculo.topico_id === top.id ? 'selected' : '';
                html += `<option value="topico:${top.id}" ${selTop}>     ↳ 🔖 ${escapeHtml(nomeTop)}</option>`;
                top.subtopicos.forEach(sub => {
                    const nomeSub = `${sub.numero || ''} ${sub.nome}`.trim();
                    const selSub = vinculo.subtopico_id === sub.id ? 'selected' : '';
                    html += `<option value="subtopico:${sub.id}" ${selSub}>        ↳ 📄 ${escapeHtml(nomeSub)}</option>`;
                });
            });
        });
        html += `</optgroup>`;
    });
    return html;
}

function abrirCriacaoAtividadeDoNo() {
    if (!NO_ATUAL) return;
    ATIVIDADE_EDITANDO = null;
    ANEXOS_REMOVER = new Set();
    const vinculoInicial = {};
    if (NO_ATUAL.tipo === 'materia') vinculoInicial.materia_id = NO_ATUAL.id;
    if (NO_ATUAL.tipo === 'topico') vinculoInicial.topico_id = NO_ATUAL.id;
    if (NO_ATUAL.tipo === 'subtopico') vinculoInicial.subtopico_id = NO_ATUAL.id;

    document.getElementById('modal-atividade-titulo').innerText = 'Nova Atividade';
    renderizarFormAtividade(null, vinculoInicial);
    document.getElementById('modal-atividade').style.display = 'flex';
}

function abrirCriacaoAtividadeGeral() {
    ATIVIDADE_EDITANDO = null;
    ANEXOS_REMOVER = new Set();
    document.getElementById('modal-atividade-titulo').innerText = 'Nova Atividade';
    renderizarFormAtividade(null, {});
    document.getElementById('modal-atividade').style.display = 'flex';
}

function editarAtividade(id) {
    const a = ATIVIDADES.find(x => x.id === id);
    if (!a) return;
    ATIVIDADE_EDITANDO = id;
    ANEXOS_REMOVER = new Set();
    const vinculo = {
        plano_id: a.plano_id, materia_id: a.materia_id,
        topico_id: a.topico_id, subtopico_id: a.subtopico_id,
    };
    document.getElementById('modal-atividade-titulo').innerText = 'Editar Atividade';
    renderizarFormAtividade(a, vinculo);
    document.getElementById('modal-atividade').style.display = 'flex';
}

function renderizarFormAtividade(a, vinculo) {
    let campos = `<label>Nome</label><input type="text" id="atv-nome" value="${a ? escapeAtributo(a.nome) : ''}" placeholder="Ex: Entregar trabalho de Cálculo" required>`;

    campos += `<label>Descrição (markdown)</label>
        <div class="editor-markdown">
            <textarea id="atv-descricao" placeholder="Detalhes da atividade..." oninput="atualizarPreviewMdAtv(this.value)">${a ? escapeHtml(a.descricao || '') : ''}</textarea>
            <div class="preview" id="preview-md-atv"></div>
        </div>`;

    const dataVal = a && a.data_entrega ? new Date(a.data_entrega).toISOString().slice(0, 10) : '';
    campos += `<label>Data de entrega</label><input type="date" id="atv-data" value="${dataVal}">`;

    const tipoId = a && a.tipo ? a.tipo.id : '';
    campos += `<label>Tipo</label><select id="atv-tipo">${optionsTiposAtividade(tipoId)}</select>`;

    campos += `<label>Vincular a</label><select id="atv-vinculo">${optionsVinculoAtividade(vinculo || {})}</select>`;

    if (a && a.anexos && a.anexos.length) {
        campos += `<label>Anexos atuais</label><div id="atv-anexos-atuais">`;
        a.anexos.forEach(an => {
            campos += `<div class="anexo-linha" data-anexo-id="${an.id}" style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid #f0f3f2;">
                <a href="${escapeHtml(an.url_arquivo)}" target="_blank" rel="noopener" style="color:#1abc9c; flex:1; font-size:0.9rem; text-decoration:none;">📎 ${escapeHtml(an.nome_original)}</a>
                <button type="button" class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="marcarRemoverAnexo(${an.id})">Remover</button>
            </div>`;
        });
        campos += `</div>`;
    }

    campos += `<label>${a ? 'Adicionar novos anexos' : 'Anexos'}</label>
        <input type="file" id="atv-anexos" multiple accept=".pdf,.docx,.doc,.txt,.md,.odt,.rtf,.csv,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.py,.ipynb,.js,.ts,.html,.css,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.tex,.epub,.mp3,.mp4,.mov,.wav">
        <small style="display:block; color:#7f8c8d; font-size:0.75rem; margin-top:4px;">Pode selecionar vários de uma vez</small>`;

    if (a) {
        const statusOpts = [
            { v: 'pendente', l: '⚪ Pendente' },
            { v: 'em_andamento', l: '🟡 Em andamento' },
            { v: 'feito', l: '🟢 Feito' },
        ];
        campos += `<label>Status</label><select id="atv-status">`;
        statusOpts.forEach(o => {
            const sel = a.status === o.v ? 'selected' : '';
            campos += `<option value="${o.v}" ${sel}>${o.l}</option>`;
        });
        campos += `</select>`;
    }

    document.getElementById('modal-atividade-campos').innerHTML = campos;
    const selTipo = document.getElementById('atv-tipo');
    if (selTipo) selTipo.addEventListener('change', onTipoAtividadeChange);
    setTimeout(() => atualizarPreviewMdAtv(a ? (a.descricao || '') : ''), 0);
}

function atualizarPreviewMdAtv(texto) {
    const preview = document.getElementById('preview-md-atv');
    if (!preview) return;
    if (!texto || !texto.trim()) {
        preview.innerHTML = '<em style="color:#bdc3c7;">O preview aparece aqui...</em>';
        return;
    }
    preview.innerHTML = renderizarMarkdown(texto);
}

function onTipoAtividadeChange(e) {
    if (e.target.value === '__novo__') {
        e.target.value = '';
        TIPO_ATIVIDADE_VOLTAR_PARA_MODAL = true;
        abrirModalTiposAtividade();
    }
}

function fecharModalAtividade() {
    document.getElementById('modal-atividade').style.display = 'none';
    ATIVIDADE_EDITANDO = null;
}

function marcarRemoverAnexo(anexoId) {
    if (!confirm('Remover este anexo? (só salva ao clicar em Salvar)')) return;
    ANEXOS_REMOVER.add(anexoId);
    const linha = document.querySelector(`.anexo-linha[data-anexo-id="${anexoId}"]`);
    if (linha) {
        linha.innerHTML = `<span style="color:#e74c3c; flex:1; font-size:0.9rem;">📎 ${escapeHtml(linha.querySelector('a').innerText.replace('📎 ', ''))} — será removido</span>`;
    }
}

async function confirmarModalAtividade() {
    const nome = document.getElementById('atv-nome').value.trim();
    const descricao = document.getElementById('atv-descricao').value.trim();
    const dataStr = document.getElementById('atv-data').value;
    const tipoId = document.getElementById('atv-tipo').value;
    const vinculoVal = document.getElementById('atv-vinculo').value;
    const statusVal = document.getElementById('atv-status')?.value;

    if (!nome) { mostrarToast('Nome é obrigatório', 'error'); return; }

    const body = {
        nome,
        descricao: descricao || null,
        data_entrega: dataStr ? `${dataStr}T00:00:00` : null,
        tipo_id: tipoId ? parseInt(tipoId) : null,
        plano_id: null, materia_id: null, topico_id: null, subtopico_id: null,
    };

    if (vinculoVal) {
        const [tipoV, idV] = vinculoVal.split(':');
        if (tipoV === 'plano') body.plano_id = parseInt(idV);
        else if (tipoV === 'materia') body.materia_id = parseInt(idV);
        else if (tipoV === 'topico') body.topico_id = parseInt(idV);
        else if (tipoV === 'subtopico') body.subtopico_id = parseInt(idV);
    }

    let atividadeId = ATIVIDADE_EDITANDO;
    let resp;

    if (ATIVIDADE_EDITANDO) {
        if (statusVal) body.status = statusVal;
        resp = await apiFetch(`/api/estudos/atividades/${ATIVIDADE_EDITANDO}`, {
            method: 'PATCH', body: JSON.stringify(body)
        });
    } else {
        resp = await apiFetch('/api/estudos/atividades', {
            method: 'POST', body: JSON.stringify(body)
        });
    }

    if (!resp || !resp.ok) {
        if (resp) {
            const err = await resp.json();
            mostrarToast(err.detail || 'Erro ao salvar atividade', 'error');
        }
        return;
    }

    const atividadeSalva = await resp.json();
    atividadeId = atividadeSalva.id;

    for (const anexoId of ANEXOS_REMOVER) {
        await apiFetch(`/api/estudos/anexos/${anexoId}`, { method: 'DELETE' });
    }

    const inputAnexos = document.getElementById('atv-anexos');
    const arquivos = inputAnexos ? Array.from(inputAnexos.files) : [];
    for (const arq of arquivos) {
        const fd = new FormData();
        fd.append('arquivo', arq);
        await apiFetch(`/api/estudos/atividades/${atividadeId}/anexos`, {
            method: 'POST', body: fd
        });
    }

    mostrarToast(ATIVIDADE_EDITANDO ? 'Atividade atualizada!' : 'Atividade criada!', 'success');
    fecharModalAtividade();
    await carregarAtividades();
}

async function excluirAtividade(id) {
    if (!confirm('Excluir esta atividade?')) return;
    const resp = await apiFetch(`/api/estudos/atividades/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Atividade excluída', 'success');
        await carregarAtividades();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

// ---- Tipos de Atividade ----
function abrirModalTiposAtividade() {
    renderizarListaTiposAtividadeModal();
    document.getElementById('modal-tipos-atividade').style.display = 'flex';
}
function fecharModalTiposAtividade() {
    document.getElementById('modal-tipos-atividade').style.display = 'none';
    if (TIPO_ATIVIDADE_VOLTAR_PARA_MODAL) {
        const sel = document.getElementById('atv-tipo');
        if (sel) {
            sel.innerHTML = optionsTiposAtividade(sel.value);
            if (TIPOS_ATIVIDADE.length) sel.value = TIPOS_ATIVIDADE[TIPOS_ATIVIDADE.length - 1].id;
        }
        TIPO_ATIVIDADE_VOLTAR_PARA_MODAL = false;
    }
}
function renderizarListaTiposAtividadeModal() {
    const container = document.getElementById('modal-tipos-atividade-lista');
    if (!container) return;
    container.innerHTML = TIPOS_ATIVIDADE.map(t => `
        <div class="cat-linha">
            <input type="text" value="${escapeAtributo(t.nome)}" data-id="${t.id}"
                onblur="salvarTipoAtividadeInline(${t.id}, this.value)"
                onkeydown="if(event.key==='Enter') this.blur();">
            <button class="btn-acao excluir" onclick="excluirTipoAtividade(${t.id})" title="Excluir">✕</button>
        </div>
    `).join('') || '<p style="color:#7f8c8d; font-size:0.9rem;">Nenhum tipo ainda.</p>';
}
async function salvarTipoAtividadeInline(id, novoNome) {
    const nome = (novoNome || '').trim();
    if (!nome) { await carregarTiposAtividade(); return; }
    const atual = TIPOS_ATIVIDADE.find(t => t.id === id);
    if (atual && atual.nome === nome) return;
    const resp = await apiFetch(`/api/estudos/tipos-atividade/${id}`, {
        method: 'PATCH', body: JSON.stringify({ nome })
    });
    if (resp && resp.ok) {
        mostrarToast('Tipo atualizado', 'success');
        await carregarTiposAtividade();
        await carregarAtividades();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
        await carregarTiposAtividade();
    }
}
async function adicionarTipoAtividadeVazio() {
    const resp = await apiFetch('/api/estudos/tipos-atividade', {
        method: 'POST', body: JSON.stringify({ nome: 'Novo tipo' })
    });
    if (resp && resp.ok) {
        await carregarTiposAtividade();
        setTimeout(() => {
            const inputs = document.querySelectorAll('#modal-tipos-atividade-lista input');
            if (inputs.length) { const u = inputs[inputs.length - 1]; u.focus(); u.select(); }
        }, 100);
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}
async function excluirTipoAtividade(id) {
    if (!confirm('Excluir este tipo? As atividades que usam ele vão ficar sem tipo.')) return;
    const resp = await apiFetch(`/api/estudos/tipos-atividade/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Tipo excluído', 'success');
        await carregarTiposAtividade();
        await carregarAtividades();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

// ==========================================
// ATIVIDADES - LISTA GERAL
// ==========================================
function mudarViewAtividades(view) {
    ATIVIDADES_VIEW = view;
    document.querySelectorAll('#toggle-atividades-view button').forEach(b => {
        const ativo = b.dataset.view === view;
        b.style.background = ativo ? '#1abc9c' : 'transparent';
        b.style.color = ativo ? 'white' : '#7f8c8d';
    });
    renderizarAtividades();
}

function toggleFiltrosAtv() {
    const btn = document.getElementById('btn-filtros-atv');
    btn.classList.toggle('ativo');
    const barra = document.getElementById('atividades-filtros');
    barra.style.display = btn.classList.contains('ativo') ? 'flex' : 'none';
}

function limparFiltrosAtv() {
    ATIVIDADES_FILTROS = { nome: '', tipo_nome: '', status: '', materia_nome: '', node_nome: '' };
    document.getElementById('filtro-atv-nome').value = '';
    document.getElementById('filtro-atv-tipo').value = '';
    document.getElementById('filtro-atv-status').value = '';
    document.getElementById('filtro-atv-vinculo').value = '';
    renderizarAtividades();
}

function renderizarAtividades() {
    const body = document.getElementById('atividades-body');
    if (!body) return;
    if (ATIVIDADES_VIEW === 'lista') body.innerHTML = construirTabelaAtividades();
    else body.innerHTML = construirKanbanAtividades();
}

function atividadeBateFiltro(a) {
    const f = ATIVIDADES_FILTROS;
    if (f.nome && !(a.nome || '').toLowerCase().includes(f.nome.toLowerCase())) return false;
    if (f.tipo_nome && !((a.tipo && a.tipo.nome) || '').toLowerCase().includes(f.tipo_nome.toLowerCase())) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.materia_nome) {
        const mat = (a.caminho && a.caminho.materia_nome) || '';
        if (!mat.toLowerCase().includes(f.materia_nome.toLowerCase())) return false;
    }
    if (f.node_nome && !(a.node_nome || '').toLowerCase().includes(f.node_nome.toLowerCase())) return false;
    return true;
}

function statusLabelAtv(s) {
    return { pendente: '⚪ Pendente', em_andamento: '🟡 Em andamento', feito: '🟢 Feito' }[s] || s;
}

function construirTabelaAtividades() {
    const visiveis = ATIVIDADES.filter(atividadeBateFiltro);
    visiveis.sort((a, b) => {
        const campo = ATIVIDADES_ORDEM.campo;
        let va = a[campo], vb = b[campo];
        if (campo === 'data_entrega') { va = va || '9999'; vb = vb || '9999'; }
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return ATIVIDADES_ORDEM.direcao === 'asc' ? -1 : 1;
        if (va > vb) return ATIVIDADES_ORDEM.direcao === 'asc' ? 1 : -1;
        return 0;
    });

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    let html = '<div class="tabela-atividades"><table><thead><tr>';
    const cols = [
        { campo: 'nome', label: 'Nome' },
        { campo: 'tipo', label: 'Tipo' },
        { campo: 'data_entrega', label: 'Entrega' },
        { campo: 'status', label: 'Status' },
        { campo: 'node_nome', label: 'Vínculo' },
        { campo: null, label: 'Ações', cls: 'sem-ordem' },
    ];
    cols.forEach(c => {
        if (c.campo) {
            const ativo = ATIVIDADES_ORDEM.campo === c.campo ? 'ordenado' : '';
            const seta = ATIVIDADES_ORDEM.campo === c.campo ? (ATIVIDADES_ORDEM.direcao === 'asc' ? '▲' : '▼') : '▲';
            html += `<th class="${ativo}" onclick="ordenarAtv('${c.campo}')">${c.label} <span class="seta">${seta}</span></th>`;
        } else {
            html += `<th class="${c.cls || ''}">${c.label}</th>`;
        }
    });
    html += '</tr></thead><tbody>';

    if (!visiveis.length) {
        html += `<tr><td colspan="6" class="vazio-tabela">Nenhuma atividade ${ATIVIDADES.length ? 'com esse filtro' : 'ainda'}.</td></tr>`;
    } else {
        visiveis.forEach(a => {
            const dataFmt = a.data_entrega ? new Date(a.data_entrega).toLocaleDateString('pt-BR') : '—';
            const atrasada = a.data_entrega && a.status !== 'feito' && new Date(a.data_entrega) < hoje;
            const tipoCell = a.tipo ? `<span class="badge-tipo-atv">${escapeHtml(a.tipo.nome)}</span>` : '—';
            const vinculoCell = a.node_nome ? `${a.node_tipo === 'plano' ? '🗺️' : a.node_tipo === 'materia' ? '📂' : a.node_tipo === 'topico' ? '🔖' : '📄'} ${escapeHtml(a.node_nome)}` : '<span style="color:#bdc3c7;">—</span>';
            html += `<tr>
                <td class="col-nome">${escapeHtml(a.nome)}${a.anexos && a.anexos.length ? ` <span style="font-size:0.75rem; color:#7f8c8d; font-weight:400;">📎 ${a.anexos.length}</span>` : ''}</td>
                <td>${tipoCell}</td>
                <td class="col-data ${atrasada ? 'atrasada' : ''}">${dataFmt}${atrasada ? ' ⚠️' : ''}</td>
                <td><span class="badge-status status-${a.status}">${statusLabelAtv(a.status)}</span></td>
                <td>${vinculoCell}</td>
                <td class="col-acoes">
                    <button onclick="editarAtividade(${a.id})" title="Editar">✏️</button>
                    <button class="excluir" onclick="excluirAtividade(${a.id})" title="Excluir">✕</button>
                </td>
            </tr>`;
        });
    }
    html += '</tbody></table></div>';
    return html;
}

function setFiltroAtv(campo, valor) {
    ATIVIDADES_FILTROS[campo] = valor;
    renderizarAtividades();
}

function ordenarAtv(campo) {
    if (ATIVIDADES_ORDEM.campo === campo) {
        ATIVIDADES_ORDEM.direcao = ATIVIDADES_ORDEM.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        ATIVIDADES_ORDEM.campo = campo;
        ATIVIDADES_ORDEM.direcao = 'asc';
    }
    renderizarAtividades();
}

function construirKanbanAtividades() {
    const statuses = ['pendente', 'em_andamento', 'feito'];
    const labels = { pendente: '⚪ Pendente', em_andamento: '🟡 Em andamento', feito: '🟢 Feito' };
    const visiveis = ATIVIDADES.filter(atividadeBateFiltro);
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    let html = '<div class="kanban-board">';
    statuses.forEach(s => {
        const doStatus = visiveis.filter(a => a.status === s);
        html += `<div class="kanban-col status-${s}" data-status="${s}">
            <div class="kanban-col-header">${labels[s]} <span style="font-weight:400; opacity:0.6;">(${doStatus.length})</span></div>
            <div class="kanban-col-body" data-status="${s}" ondrop="kanbanDrop(event)" ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)">`;
        if (!doStatus.length) {
            html += `<div class="kanban-vazio">Arraste cards pra cá</div>`;
        } else {
            doStatus.forEach(a => {
                const dataFmt = a.data_entrega ? new Date(a.data_entrega).toLocaleDateString('pt-BR') : '—';
                const atrasada = a.data_entrega && a.status !== 'feito' && new Date(a.data_entrega) < hoje;
                html += `<div class="kanban-card" data-id="${a.id}">
                    <div class="card-acoes">
                        <button onclick="event.stopPropagation(); editarAtividade(${a.id})" title="Editar">✏️</button>
                        <button class="excluir" onclick="event.stopPropagation(); excluirAtividade(${a.id})" title="Excluir">✕</button>
                    </div>
                    <div class="drag-handle" draggable="true" data-id="${a.id}" ondragstart="kanbanDragStart(event, ${a.id})" title="Arrastar">⋮⋮</div>
                    <div class="nome">${escapeHtml(a.nome)}${a.anexos && a.anexos.length ? ` <span style="font-size:0.75rem; color:#7f8c8d; font-weight:400;">📎 ${a.anexos.length}</span>` : ''}</div>
                    <div class="meta">
                        ${a.tipo ? `<span class="badge-tipo-atv">${escapeHtml(a.tipo.nome)}</span>` : ''}
                        <span class="data ${atrasada ? 'atrasada' : ''}">📅 ${dataFmt}</span>
                    </div>
                    ${a.node_nome ? `<div class="meta" style="margin-top:4px;">${escapeHtml(a.node_nome)}</div>` : ''}
                </div>`;
            });
        }
        html += `</div></div>`;
    });
    html += '</div>';
    return html;
}

function kanbanDragStart(e, id) {
    kanbanDragId = id;
    const card = e.target.closest('.kanban-card');
    if (card) card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
}

function kanbanDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function kanbanDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function kanbanDrop(e) {
    e.preventDefault();
    const col = e.currentTarget;
    col.classList.remove('drag-over');
    const novoStatus = col.dataset.status;
    if (!kanbanDragId || !novoStatus) return;

    const atividade = ATIVIDADES.find(a => a.id === kanbanDragId);
    if (!atividade || atividade.status === novoStatus) {
        kanbanDragId = null;
        return;
    }

    const resp = await apiFetch(`/api/estudos/atividades/${kanbanDragId}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: novoStatus })
    });
    kanbanDragId = null;

    if (resp && resp.ok) {
        mostrarToast('Status atualizado', 'success');
        await carregarAtividades();
        renderizarAtividades();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}