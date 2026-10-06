// ==========================================
// NAVEGAÇÃO DE MODO
// ==========================================
function mudarModo(novoModo) {
    MODO = novoModo;
    desmaximizar();
    ['mapa', 'lista', 'materiais', 'atividades', 'agenda', 'conta'].forEach(m => {
        const btn = document.getElementById(`btn-modo-${m}`);
        if (btn) btn.classList.toggle('ativo', m === novoModo);
    });
    renderizarModoAtual();
}

function renderizarModoAtual() {
    const vazio = document.getElementById('vazio-superior');
    const svgEl = document.getElementById('mapa-svg');
    const listaEl = document.getElementById('lista-container');
    const contaEl = document.getElementById('conta-container');
    const materiaisEl = document.getElementById('materiais-container');
    const controles = document.getElementById('mapa-controles');
    const agendaEl = document.getElementById('agenda-container');
    const atividadesEl = document.getElementById('atividades-container');

    contaEl.style.display = 'none';
    materiaisEl.style.display = 'none';
    agendaEl.style.display = 'none';
    atividadesEl.style.display = 'none';

    vazio.style.display = 'none';
    svgEl.style.display = 'none';
    listaEl.style.display = 'none';
    controles.style.display = 'none';

    if (MODO === 'conta') { contaEl.style.display = 'block'; return; }

    if (MODO === 'materiais') {
        materiaisEl.style.display = 'block';
        renderizarTabelaMateriais();
        return;
    }

    if (MODO === 'agenda') {
        agendaEl.style.display = 'flex';
        carregarAgenda().then(() => renderizarAgenda());
        return;
    }

    if (MODO === 'atividades') {
        atividadesEl.style.display = 'block';
        carregarAtividades().then(() => renderizarAtividades());
        return;
    }

    if (MODO === 'mapa') {
        svgEl.style.display = 'block';
        controles.style.display = 'flex';
        renderizarMapa();
    } else {
        if (!ARVORE.length) { vazio.style.display = 'block'; return; }
        listaEl.style.display = 'block';
        renderizarLista();
    }
}

// ==========================================
// TABS
// ==========================================
function trocarTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    const el = document.getElementById(`tab-${tab}`);
    if (el) { el.classList.add('active'); el.style.display = 'block'; }
}

// ==========================================
// MAXIMIZAR
// ==========================================
function toggleMaximizar() {
    document.body.classList.toggle('conteudo-maximizado');
    const btn = document.getElementById('btn-maximizar');
    if (document.body.classList.contains('conteudo-maximizado')) {
        btn.innerText = '⛉';
        btn.title = 'Restaurar';
    } else {
        btn.innerText = '⛶';
        btn.title = 'Maximizar';
    }
}

function desmaximizar() {
    document.body.classList.remove('conteudo-maximizado');
    const btn = document.getElementById('btn-maximizar');
    if (btn) { btn.innerText = '⛶'; btn.title = 'Maximizar'; }
}

// ==========================================
// DROPDOWNS DE CONTEXTO
// ==========================================
function abrirDropdown(event, tipo, id, statusAtual) {
    event.stopPropagation();
    fecharDropdown();
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown-status';

    const filhos = {
        plano: { label: '➕ Nova matéria', acao: () => abrirCriacao('materia', id) },
        materia: { label: '➕ Novo tópico', acao: () => abrirCriacao('topico', id) },
        topico: { label: '➕ Novo subtópico', acao: () => abrirCriacao('subtopico', id) },
    };
    if (filhos[tipo]) {
        const add = document.createElement('div');
        add.className = 'item add';
        add.innerHTML = filhos[tipo].label;
        add.onclick = (e) => { e.stopPropagation(); fecharDropdown(); filhos[tipo].acao(); };
        dropdown.appendChild(add);
        dropdown.appendChild(sep());
    }

    // Status: só pra tópico, subtópico, matéria e plano
    if (['plano', 'materia', 'topico', 'subtopico'].includes(tipo)) {
        const recurso = tipo === 'plano' ? 'planos'
                      : tipo === 'materia' ? 'materias'
                      : tipo === 'topico' ? 'topicos'
                      : 'subtopicos';

        // Procura o status_manual atual na árvore
        let statusManualAtual = 'auto';
        if (tipo === 'plano') {
            const p = ARVORE.find(x => x.id === id);
            if (p) statusManualAtual = p.status_manual || 'auto';
        } else if (tipo === 'materia') {
            for (const p of ARVORE) {
                const m = p.materias.find(x => x.id === id);
                if (m) { statusManualAtual = m.status_manual || 'auto'; break; }
            }
        } else if (tipo === 'topico') {
            for (const p of ARVORE) for (const m of p.materias) {
                const t = m.topicos.find(x => x.id === id);
                if (t) { statusManualAtual = t.status_manual || 'auto'; break; }
            }
        } else {
            for (const p of ARVORE) for (const m of p.materias) for (const t of m.topicos) {
                const s = t.subtopicos.find(x => x.id === id);
                if (s) { statusManualAtual = s.status_manual || 'adicionado'; break; }
            }
        }

        const opcoes = tipo === 'subtopico'
            ? [
                { valor: 'adicionado', label: 'Adicionado', icone: '⚪' },
                { valor: 'em_estudo',  label: 'Em estudo',  icone: '🟡' },
                { valor: 'concluido',  label: 'Concluído',  icone: '🟢' },
              ]
            : [
                { valor: 'auto',       label: 'Automático', icone: '🔄' },
                { valor: 'adicionado', label: 'Adicionado', icone: '⚪' },
                { valor: 'em_estudo',  label: 'Em estudo',  icone: '🟡' },
                { valor: 'concluido',  label: 'Concluído',  icone: '🟢' },
              ];

        opcoes.forEach(op => {
            const item = document.createElement('div');
            item.className = 'item';
            const check = op.valor === statusManualAtual ? '<span class="check">✓</span>' : '';
            item.innerHTML = `${op.icone} ${op.label} ${check}`;
            item.onclick = (e) => {
                e.stopPropagation();
                mudarStatusManual(recurso, id, op.valor);
            };
            dropdown.appendChild(item);
        });
        dropdown.appendChild(sep());
    }

    const recurso = tipo === 'plano' ? 'planos' : (tipo === 'materia' ? 'materias' : (tipo === 'topico' ? 'topicos' : 'subtopicos'));

    const itemEditar = document.createElement('div');
    itemEditar.className = 'item';
    itemEditar.innerHTML = '✏️ Editar';
    itemEditar.onclick = (e) => { e.stopPropagation(); fecharDropdown(); editarItem(recurso, id); };
    dropdown.appendChild(itemEditar);

    const itemExcluir = document.createElement('div');
    itemExcluir.className = 'item perigo';
    itemExcluir.innerHTML = '✕ Excluir';
    itemExcluir.onclick = (e) => { e.stopPropagation(); fecharDropdown(); excluirItem(recurso, id); };
    dropdown.appendChild(itemExcluir);

    document.body.appendChild(dropdown);
    posicionarDropdown(dropdown, event.target);
    dropdownAberto = dropdown;
}

function abrirDropdownRaiz(event) {
    event.stopPropagation();
    fecharDropdown();
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown-status';
    const itemNovoPlano = document.createElement('div');
    itemNovoPlano.className = 'item add';
    itemNovoPlano.innerHTML = '➕ Novo plano';
    itemNovoPlano.onclick = (e) => { e.stopPropagation(); fecharDropdown(); criarPlano(); };
    dropdown.appendChild(itemNovoPlano);
    dropdown.appendChild(sep());
    const itemCor = document.createElement('div');
    itemCor.className = 'item';
    itemCor.innerHTML = '🎨 Escolher cor';
    itemCor.onclick = (e) => { e.stopPropagation(); mostrarSubmenuCores(dropdown); };
    dropdown.appendChild(itemCor);
    document.body.appendChild(dropdown);
    posicionarDropdown(dropdown, event.target);
    dropdownAberto = dropdown;
}

function mostrarSubmenuCores(dropdownPai) {
    dropdownPai.innerHTML = '';
    const voltar = document.createElement('div');
    voltar.className = 'voltar-submenu';
    voltar.innerHTML = '← Voltar';
    voltar.onclick = (e) => {
        e.stopPropagation();
        fecharDropdown();
        const ev = new MouseEvent('contextmenu', { bubbles: true });
        abrirDropdownRaiz(ev);
    };
    dropdownPai.appendChild(voltar);
    dropdownPai.appendChild(sep());
    const grid = document.createElement('div');
    grid.className = 'cores-grid';
    const corAtual = corDaRaiz();
    CORES_DISPONIVEIS.forEach(c => {
        const bola = document.createElement('div');
        bola.className = 'cor-bolinha' + (c.hex === corAtual ? ' ativa' : '');
        bola.style.background = c.hex;
        bola.title = c.nome;
        bola.onclick = async (e) => { e.stopPropagation(); await trocarCorRaiz(c.hex); fecharDropdown(); };
        grid.appendChild(bola);
    });
    dropdownPai.appendChild(grid);
}

async function trocarCorRaiz(novaCor) {
    const resp = await apiFetch('/api/auth/me/cor', {
        method: 'PATCH', body: JSON.stringify({ cor_raiz: novaCor })
    });
    if (resp && resp.ok) {
        const usuarioAtualizado = await resp.json();
        USUARIO.cor_raiz = usuarioAtualizado.cor_raiz;
        localStorage.setItem('usuario', JSON.stringify(USUARIO));
        mostrarToast('Cor atualizada', 'success');
        g.selectAll('g.node').filter(d => d.data && d.data.tipo === 'raiz')
            .select('circle').transition().duration(300)
            .style('fill', novaCor).style('stroke', novaCor);
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

// ==========================================
// MUDAR STATUS (tópico/subtópico)
// ==========================================
async function mudarStatusManual(recurso, id, novoStatus) {
    fecharDropdown();
    const resp = await apiFetch(`/api/estudos/${recurso}/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: novoStatus })
    });
    if (resp && resp.ok) {
        mostrarToast('Status atualizado', 'success');
        await carregarArvore();
    } else if (resp) {
        const err = await resp.json();
        mostrarToast(err.detail || 'Erro', 'error');
    }
}

// ==========================================
// EXCLUIR ITEM (genérico)
// ==========================================
async function excluirItem(recurso, id) {
    if (!confirm('Tem certeza que quer excluir?')) return;
    const resp = await apiFetch(`/api/estudos/${recurso}/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Excluído', 'success');
        if (recurso === 'planos' && PLANO_ATUAL && PLANO_ATUAL.id === id) { PLANO_ATUAL = null; NO_ATUAL = null; }
        if ((recurso === 'topicos' || recurso === 'subtopicos') && NO_ATUAL && NO_ATUAL.id === id) NO_ATUAL = null;
        await carregarArvore();
    } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
}

function deletarItem(tipo, id) { return excluirItem(tipo, id); }