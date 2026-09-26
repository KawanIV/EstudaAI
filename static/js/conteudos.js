// ==========================================
// CONTEÚDO DO NÓ (tópico/matéria/subtópico)
// ==========================================
function renderizarConteudoDoNo() {
    if (!NO_ATUAL || !NO_ATUAL.ref) {
        document.getElementById('bem-vindo-conteudo').style.display = 'block';
        document.getElementById('conteudo-area').style.display = 'none';
        desmaximizar();
        return;
    }
    desmaximizar();

    const no = NO_ATUAL.ref;
    document.getElementById('bem-vindo-conteudo').style.display = 'none';
    document.getElementById('conteudo-area').style.display = 'block';
    document.getElementById('titulo-subtopico').innerText = `📄 ${no.numero ? no.numero + ' ' : ''}${no.nome}`.trim();

    const tabs = [];
    if (NO_ATUAL.tipo === 'topico' || NO_ATUAL.tipo === 'subtopico') {
        tabs.push({ id: 'material', label: '📖 Material' });
        tabs.push({ id: 'resumo', label: '📝 Resumo' });
        tabs.push({ id: 'link', label: '🔗 Links' });
        tabs.push({ id: 'pdf', label: '📄 PDFs' });
        if (NO_ATUAL.tipo === 'topico') tabs.push({ id: 'subtopicos', label: '📂 Subtópicos' });
        tabs.push({ id: 'atividades', label: '📝 Atividades' });
        tabs.push({ id: 'agenda', label: '📅 Agenda' });
    } else if (NO_ATUAL.tipo === 'materia') {
        tabs.push({ id: 'atividades', label: '📝 Atividades' });
    }

    document.getElementById('tabs-container').innerHTML = tabs.map((t, idx) =>
        `<button class="tab-btn ${idx === 0 ? 'active' : ''}" data-tab="${t.id}" onclick="trocarTab('${t.id}')">${t.label}</button>`
    ).join('');

    if (NO_ATUAL.tipo === 'topico' || NO_ATUAL.tipo === 'subtopico') {
        renderizarConteudos(no, NO_ATUAL.tipo);
        if (NO_ATUAL.tipo === 'topico') renderizarTabSubtopicos(no);
        renderizarTabAgendaNo(no, NO_ATUAL.tipo);
    }
    renderizarTabAtividades(no, NO_ATUAL.tipo);

    trocarTab(tabs[0].id);
}

function renderizarConteudos(no, tipo) {
    const tipos = { material: [], resumo: [], link: [], pdf: [] };
    (no.conteudos || []).forEach(c => { if (tipos[c.tipo]) tipos[c.tipo].push(c); });
    Object.keys(tipos).forEach(t => {
        const container = document.getElementById(`tab-${t}`);
        let html = '';
        if (!tipos[t].length) {
            html = `<p style="color:#7f8c8d;">Nenhum conteúdo de <strong>${t}</strong> ainda.</p>`;
        } else {
            tipos[t].forEach(c => {
                html += `<div class="conteudo-bloco">
                    <button class="btn-editar-conteudo" onclick="abrirEdicaoConteudo(${c.id})" title="Editar">✏️</button>
                    <button class="btn-del" onclick="deletarItem('conteudos', ${c.id})" title="Excluir">✕</button>
                    ${c.titulo ? `<h4>${escapeHtml(c.titulo)}</h4>` : ''}
                    ${renderizarCorpoConteudo(c, t)}
                </div>`;
            });
        }
        html += `<button class="tab-add-btn" onclick="abrirCriacaoConteudo('${t}')">+ Adicionar ${rotuloTipo(t)}</button>`;
        container.innerHTML = html;
    });
}

function renderizarTabSubtopicos(topico) {
    const container = document.getElementById('tab-subtopicos');
    let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-size:0.9rem; color:#7f8c8d;">Subtópicos deste tópico</span>
        <button class="btn btn-primary" style="padding:8px 14px; font-size:0.85rem;" onclick="abrirCriacao('subtopico', ${topico.id})">+ Novo Subtópico</button>
    </div>`;
    if (!topico.subtopicos.length) {
        html += `<p style="color:#7f8c8d;">Nenhum subtópico ainda.</p>`;
    } else {
        html += `<div class="lista-plano">`;
        topico.subtopicos.forEach(sub => {
            const nomeSub = `${sub.numero || ''} ${sub.nome}`.trim();
            const ativo = NO_ATUAL && NO_ATUAL.tipo === 'subtopico' && NO_ATUAL.id === sub.id ? 'ativo' : '';
            html += `<div class="lista-subtopico" style="margin-left:0;">
                <div class="lista-item ${ativo}" onclick="selecionarNo('subtopico', ${sub.id})">
                    <span class="status-pill ${sub.status}">${sub.porcentagem}%</span>
                    <span class="nome-flex">📄 ${escapeHtml(nomeSub)}</span>
                    ${badgeCat(sub.categoria)}
                    <button class="btn-edit-small" onclick="event.stopPropagation(); editarItem('subtopicos', ${sub.id})" title="Editar">✏️</button>
                    <button class="btn-menu-small" onclick="event.stopPropagation(); abrirDropdown(event, 'subtopico', ${sub.id}, '${sub.status || 'adicionado'}')" title="Mais opções">⋯</button>
                </div>
            </div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
}

function renderizarCorpoConteudo(c, tipo) {
    let partes = [];
    if (c.texto) {
        const mostrarCru = CONTEUDOS_MD_CRU.has(c.id);
        if (tipo === 'material' || tipo === 'resumo') {
            const toggleLabel = mostrarCru ? 'Ver renderizado' : 'Ver markdown cru';
            const corpo = mostrarCru
                ? `<pre class="markdown-cru">${escapeHtml(c.texto)}</pre>`
                : `<div class="markdown-render">${renderizarMarkdown(c.texto)}</div>`;
            partes.push(`<div>
                <button class="btn-toggle-md" onclick="event.stopPropagation(); toggleMarkdownCru(${c.id})">${toggleLabel}</button>
                ${corpo}
            </div>`);
        } else {
            partes.push(`<p>${escapeHtml(c.texto).replace(/\n/g, '<br>')}</p>`);
        }
    }
    if (c.url_link) partes.push(`<a href="${escapeHtml(c.url_link)}" target="_blank" rel="noopener">${escapeHtml(c.url_link)}</a>`);
    if (c.url_arquivo) partes.push(`<a href="${escapeHtml(c.url_arquivo)}" target="_blank" rel="noopener">📎 Baixar arquivo anexado</a>`);
    return partes.join('') || '<em>Sem conteúdo.</em>';
}

function rotuloTipo(tipo) { return { material: 'Material', resumo: 'Resumo', link: 'Link', pdf: 'PDF' }[tipo]; }

// ==========================================
// MODAL CONTEÚDO (criar + editar)
// ==========================================
function abrirCriacaoConteudo(tipo) {
    if (!NO_ATUAL) { mostrarToast('Selecione um tópico ou subtópico', 'error'); return; }
    TIPO_CONTEUDO = tipo;
    CONTEUDO_EDITANDO = null;
    CONTEUDO_EDITANDO_ARQUIVO = false;
    document.getElementById('modal-conteudo-titulo').innerText = `Adicionar ${rotuloTipo(tipo)}`;

    let campos = `<label>Título</label><input type="text" id="conteudo-titulo" placeholder="Opcional">`;
    if (tipo === 'link') {
        campos += `<label>URL</label><input type="url" id="conteudo-link" placeholder="https://...">`;
    } else {
        const usarMarkdown = (tipo === 'material' || tipo === 'resumo');
        if (usarMarkdown) {
            campos += `<label>Texto (markdown)</label>
                <div class="editor-markdown">
                    <textarea id="conteudo-texto" placeholder="Escreva em markdown..." oninput="atualizarPreviewMd(this.value)"></textarea>
                    <div class="preview" id="preview-md"></div>
                </div>`;
        } else {
            campos += `<label>Texto</label><textarea id="conteudo-texto" placeholder="Opcional..."></textarea>`;
        }
        campos += `<label>Arquivo</label><input type="file" id="conteudo-arquivo" accept=".pdf,.docx,.doc,.txt,.md,.odt,.rtf,.csv,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.py,.ipynb,.js,.ts,.html,.css,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.tex,.epub,.mp3,.mp4,.mov,.wav">`;
    }
    document.getElementById('modal-conteudo-campos').innerHTML = campos;
    document.getElementById('modal-conteudo').style.display = 'flex';
    document.querySelector('#modal-conteudo .btn-primary').innerText = 'Adicionar';
    if (tipo === 'material' || tipo === 'resumo') atualizarPreviewMd('');
}

function atualizarPreviewMd(texto) {
    const preview = document.getElementById('preview-md');
    if (!preview) return;
    if (!texto || !texto.trim()) {
        preview.innerHTML = '<em style="color:#bdc3c7;">O preview aparece aqui...</em>';
        return;
    }
    preview.innerHTML = renderizarMarkdown(texto);
}

function abrirEdicaoConteudo(conteudoId) {
    let conteudoEncontrado = null;
    if (NO_ATUAL && NO_ATUAL.ref && NO_ATUAL.ref.conteudos) {
        conteudoEncontrado = NO_ATUAL.ref.conteudos.find(c => c.id === conteudoId);
    }
    if (!conteudoEncontrado) { mostrarToast('Conteúdo não encontrado', 'error'); return; }

    CONTEUDO_EDITANDO = conteudoEncontrado;
    CONTEUDO_EDITANDO_ARQUIVO = false;
    TIPO_CONTEUDO = null;
    const c = conteudoEncontrado;
    const tipo = c.tipo;

    document.getElementById('modal-conteudo-titulo').innerText = `Editar ${rotuloTipo(tipo)}`;
    let campos = `<label>Título</label><input type="text" id="conteudo-titulo" value="${escapeAtributo(c.titulo || '')}" placeholder="Opcional">`;

    if (tipo === 'link') {
        campos += `<label>URL</label><input type="url" id="conteudo-link" value="${escapeAtributo(c.url_link || '')}" placeholder="https://...">`;
    } else {
        const usarMarkdown = (tipo === 'material' || tipo === 'resumo');
        if (usarMarkdown) {
            campos += `<label>Texto (markdown)</label>
                <div class="editor-markdown">
                    <textarea id="conteudo-texto" placeholder="Escreva em markdown..." oninput="atualizarPreviewMd(this.value)">${escapeHtml(c.texto || '')}</textarea>
                    <div class="preview" id="preview-md"></div>
                </div>`;
        } else {
            campos += `<label>Texto</label><textarea id="conteudo-texto" placeholder="Opcional...">${escapeHtml(c.texto || '')}</textarea>`;
        }
        if (c.url_arquivo) {
            campos += `<label>Arquivo atual</label>
                <div id="bloco-arquivo-atual" style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <a href="${escapeHtml(c.url_arquivo)}" target="_blank" rel="noopener" style="color:#1abc9c; font-size:0.9rem; flex:1;">📎 ${escapeHtml(c.url_arquivo.split('/').pop())}</a>
                    <button type="button" class="btn btn-secondary" style="padding:6px 12px; font-size:0.8rem;" onclick="marcarRemoverArquivo()">Remover</button>
                </div>
                <label>Substituir por novo arquivo (opcional)</label>`;
        } else {
            campos += `<label>Arquivo (opcional)</label>`;
        }
        campos += `<input type="file" id="conteudo-arquivo" accept=".pdf,.docx,.doc,.txt,.md,.odt,.rtf,.csv,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.py,.ipynb,.js,.ts,.html,.css,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.tex,.epub,.mp3,.mp4,.mov,.wav">`;
    }

    document.getElementById('modal-conteudo-campos').innerHTML = campos;
    document.getElementById('modal-conteudo').style.display = 'flex';
    document.querySelector('#modal-conteudo .btn-primary').innerText = 'Salvar';
    if (tipo === 'material' || tipo === 'resumo') atualizarPreviewMd(c.texto || '');
}

function marcarRemoverArquivo() {
    if (!confirm('Remover o arquivo atual? (só salva ao clicar em Salvar)')) return;
    CONTEUDO_EDITANDO_ARQUIVO = true;
    const bloco = document.getElementById('bloco-arquivo-atual');
    if (bloco) bloco.innerHTML = '<span style="color:#e74c3c;">📎 Arquivo marcado para remoção</span>';
}

function fecharModalConteudo() {
    document.getElementById('modal-conteudo').style.display = 'none';
    TIPO_CONTEUDO = null;
    CONTEUDO_EDITANDO = null;
    CONTEUDO_EDITANDO_ARQUIVO = false;
    const btn = document.querySelector('#modal-conteudo .btn-primary');
    if (btn) btn.innerText = 'Adicionar';
}

async function confirmarModalConteudo() {
    const titulo = document.getElementById('conteudo-titulo')?.value.trim();
    const texto = document.getElementById('conteudo-texto')?.value.trim();
    const link = document.getElementById('conteudo-link')?.value.trim();
    const arquivo = document.getElementById('conteudo-arquivo')?.files[0];

    if (CONTEUDO_EDITANDO) {
        const tipo = CONTEUDO_EDITANDO.tipo;
        if (tipo === 'link' && !link) { mostrarToast('Informe o link', 'error'); return; }

        const fd = new FormData();
        fd.append('titulo', titulo || '');
        if (tipo === 'link') fd.append('url_link', link || '');
        else fd.append('texto', texto || '');
        if (arquivo) fd.append('arquivo', arquivo);
        if (CONTEUDO_EDITANDO_ARQUIVO) fd.append('remover_arquivo', 'true');

        const resp = await apiFetch(`/api/estudos/conteudos/${CONTEUDO_EDITANDO.id}`, {
            method: 'PATCH', body: fd
        });
        if (resp && resp.ok) {
            mostrarToast('Conteúdo atualizado!', 'success');
            fecharModalConteudo();
            await carregarArvore();
        } else if (resp) {
            const err = await resp.json();
            mostrarToast(err.detail || 'Erro', 'error');
        }
        return;
    }

    if (TIPO_CONTEUDO === 'link' && !link) { mostrarToast('Informe o link', 'error'); return; }
    if (!texto && !arquivo && !link) { mostrarToast('Preencha texto ou arquivo', 'error'); return; }

    const formData = new FormData();
    formData.append('tipo', TIPO_CONTEUDO);
    if (NO_ATUAL.tipo === 'topico') formData.append('topico_id', NO_ATUAL.id);
    else formData.append('subtopico_id', NO_ATUAL.id);
    if (titulo) formData.append('titulo', titulo);
    if (texto) formData.append('texto', texto);
    if (link) formData.append('url_link', link);
    if (arquivo) formData.append('arquivo', arquivo);

    const resp = await apiFetch('/api/estudos/conteudos', { method: 'POST', body: formData });
    if (resp && resp.ok) {
        mostrarToast('Conteúdo adicionado!', 'success');
        fecharModalConteudo();
        await carregarArvore();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}