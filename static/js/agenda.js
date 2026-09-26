// ==========================================
// AGENDA
// ==========================================
async function carregarAgenda() {
    const resp = await apiFetch('/api/estudos/agenda');
    if (!resp) return;
    AGENDAMENTOS = await resp.json();
}
function mudarViewAgenda(view) {
    AGENDA_VIEW = view;
    document.querySelectorAll('.agenda-views button').forEach(b => {
        b.classList.toggle('ativo', b.dataset.view === view);
    });
    document.getElementById('agenda-nav').style.display = view === 'lista' ? 'none' : 'flex';
    renderizarAgenda();
}
function agendaAnterior() {
    if (AGENDA_VIEW === 'mensal') AGENDA_DATA_REF = new Date(AGENDA_DATA_REF.getFullYear(), AGENDA_DATA_REF.getMonth() - 1, 1);
    else if (AGENDA_VIEW === 'semanal') { const d = new Date(AGENDA_DATA_REF); d.setDate(d.getDate() - 7); AGENDA_DATA_REF = d; }
    renderizarAgenda();
}
function agendaProximo() {
    if (AGENDA_VIEW === 'mensal') AGENDA_DATA_REF = new Date(AGENDA_DATA_REF.getFullYear(), AGENDA_DATA_REF.getMonth() + 1, 1);
    else if (AGENDA_VIEW === 'semanal') { const d = new Date(AGENDA_DATA_REF); d.setDate(d.getDate() + 7); AGENDA_DATA_REF = d; }
    renderizarAgenda();
}
function agendaHoje() { AGENDA_DATA_REF = new Date(); renderizarAgenda(); }

function renderizarAgenda() {
    const body = document.getElementById('agenda-body');
    const titulo = document.getElementById('agenda-titulo-periodo');
    if (AGENDA_VIEW === 'mensal') {
        titulo.innerText = AGENDA_DATA_REF.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        body.innerHTML = construirAgendaMensal();
    } else if (AGENDA_VIEW === 'semanal') {
        titulo.innerText = construirTituloSemana();
        body.innerHTML = construirAgendaSemanal();
    } else {
        titulo.innerText = 'Próximos eventos';
        body.innerHTML = construirAgendaLista();
    }
}
function construirTituloSemana() {
    const { inicio, fim } = calcularRangeSemana(AGENDA_DATA_REF);
    return `${inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
}
function calcularRangeSemana(data) {
    const d = new Date(data);
    const inicio = new Date(d);
    inicio.setDate(d.getDate() - d.getDay());
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
}
function agendamentosNoDia(data) {
    const inicioDia = new Date(data); inicioDia.setHours(0, 0, 0, 0);
    const fimDia = new Date(data); fimDia.setHours(23, 59, 59, 999);
    return AGENDAMENTOS.filter(a => {
        const dt = new Date(a.data_inicio);
        return dt >= inicioDia && dt <= fimDia;
    }).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
}
function statusDoAgendamento(a) {
    const no = a.topico_id ? encontrarNo('topico', a.topico_id) : encontrarNo('subtopico', a.subtopico_id);
    return no ? no.status : 'adicionado';
}
function construirAgendaMensal() {
    const ano = AGENDA_DATA_REF.getFullYear();
    const mes = AGENDA_DATA_REF.getMonth();
    const primeiro = new Date(ano, mes, 1);
    const diaSemanaInicio = primeiro.getDay();
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let html = '<div class="grade-mensal">';
    ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach(d => {
        html += `<div class="dia-cabecalho">${d}</div>`;
    });
    const totalCelulas = Math.ceil((diaSemanaInicio + diasNoMes) / 7) * 7;
    for (let i = 0; i < totalCelulas; i++) {
        const diaNumero = i - diaSemanaInicio + 1;
        const data = new Date(ano, mes, diaNumero);
        const foraDoMes = diaNumero < 1 || diaNumero > diasNoMes;
        const isHoje = !foraDoMes && data.getTime() === hoje.getTime();
        const eventos = foraDoMes ? [] : agendamentosNoDia(data);
        const visiveis = eventos.slice(0, 3);
        let cls = 'dia-celula';
        if (foraDoMes) cls += ' fora-do-mes';
        if (isHoje) cls += ' hoje';
        html += `<div class="${cls}">`;
        html += `<div class="dia-numero">${data.getDate()}</div>`;
        visiveis.forEach(ev => {
            const status = statusDoAgendamento(ev);
            const hora = new Date(ev.data_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            html += `<div class="evento-mini status-${status}" onclick="irParaAgendamento(${ev.id})" title="${escapeAtributo(ev.node_nome)}">${hora} ${escapeHtml(ev.node_nome)}</div>`;
        });
        if (eventos.length > 3) {
            html += `<div class="mais-eventos">+${eventos.length - 3} mais</div>`;
        }
        html += `</div>`;
    }
    html += '</div>';
    return html;
}
function construirAgendaSemanal() {
    const { inicio } = calcularRangeSemana(AGENDA_DATA_REF);
    const HORA_INI = 6, HORA_FIM = 23;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let html = '<div class="grade-semanal">';
    html += `<div class="hora-cabecalho"></div>`;
    for (let d = 0; d < 7; d++) {
        const dia = new Date(inicio); dia.setDate(inicio.getDate() + d);
        const isHoje = dia.getTime() === hoje.getTime();
        const diaLabel = dia.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
        html += `<div class="dia-cabecalho-sem" style="${isHoje ? 'background:#1abc9c;' : ''}">${diaLabel}</div>`;
    }
    for (let h = HORA_INI; h <= HORA_FIM; h++) {
        html += `<div class="hora-label">${String(h).padStart(2, '0')}:00</div>`;
        for (let d = 0; d < 7; d++) {
            const dia = new Date(inicio); dia.setDate(inicio.getDate() + d);
            const isHoje = dia.getTime() === hoje.getTime();
            const eventosNessaHora = agendamentosNoDia(dia).filter(a => new Date(a.data_inicio).getHours() === h);
            html += `<div class="hora-celula ${isHoje ? 'hoje' : ''}">`;
            eventosNessaHora.forEach(ev => {
                const status = statusDoAgendamento(ev);
                const dtIni = new Date(ev.data_inicio);
                const dtFim = new Date(ev.data_fim);
                const duracaoMin = (dtFim - dtIni) / 60000;
                const topPx = (dtIni.getMinutes() / 60) * 48;
                const altPx = (duracaoMin / 60) * 48 - 2;
                const hora = dtIni.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                html += `<div class="evento-semanal status-${status}" style="top:${topPx}px; height:${altPx}px;" onclick="irParaAgendamento(${ev.id})" title="${escapeAtributo(ev.node_nome)}">
                    <strong>${hora}</strong><br>${escapeHtml(ev.node_nome)}
                </div>`;
            });
            html += `</div>`;
        }
    }
    html += '</div>';
    return html;
}
function construirAgendaLista() {
    const agora = new Date();
    const futuros = AGENDAMENTOS.filter(a => new Date(a.data_fim) >= agora);
    if (!futuros.length) return '<div class="agenda-vazia">📭 Nenhum evento futuro.</div>';
    futuros.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    let html = '<div class="lista-eventos">';
    futuros.forEach(ev => {
        const status = statusDoAgendamento(ev);
        const dtIni = new Date(ev.data_inicio);
        const dtFim = new Date(ev.data_fim);
        const dataFormatada = dtIni.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
        const horaIni = dtIni.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const horaFim = dtFim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const caminhoStr = ev.caminho ? [ev.caminho.plano_nome, ev.caminho.materia_nome, ev.caminho.topico_nome].filter(Boolean).join(' › ') : '';
        html += `<div class="evento-card status-${status}">
            <div class="info">
                <div class="data">${dataFormatada} · ${horaIni}–${horaFim}</div>
                <div class="node-nome">${escapeHtml(ev.node_nome)}</div>
                ${caminhoStr ? `<div class="caminho">${escapeHtml(caminhoStr)}</div>` : ''}
            </div>
            <div class="acoes">
                <button onclick="editarAgendamento(${ev.id})" title="Editar">✏️</button>
                <button class="excluir" onclick="excluirAgendamento(${ev.id})" title="Excluir">✕</button>
            </div>
        </div>`;
    });
    html += '</div>';
    return html;
}
function irParaAgendamento(agendamentoId) {
    const ev = AGENDAMENTOS.find(a => a.id === agendamentoId);
    if (!ev) return;
    const planoId = ev.caminho?.plano_id;
    if (planoId) {
        NOS_EXPANDIDOS.add(`plano-${planoId}`);
        if (ev.caminho.materia_id) NOS_EXPANDIDOS.add(`mat-${ev.caminho.materia_id}`);
        if (ev.caminho.topico_id) NOS_EXPANDIDOS.add(`top-${ev.caminho.topico_id}`);
        if (ev.topico_id) NOS_EXPANDIDOS.add(`top-${ev.topico_id}`);
    }
    mudarModo('mapa');
    if (ev.topico_id) selecionarNo('topico', ev.topico_id);
    else if (ev.subtopico_id) selecionarNo('subtopico', ev.subtopico_id);
    setTimeout(() => {
        document.getElementById('conteudo-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
}
function renderizarTabAgendaNo(no, tipo) {
    const container = document.getElementById('tab-agenda');
    const agendamentos = no.horarios || [];
    let html = '';
    if (!agendamentos.length) {
        html = `<p style="color:#7f8c8d;">Nenhum agendamento ainda.</p>`;
    } else {
        agendamentos.forEach(ev => {
            const dtIni = new Date(ev.data_inicio);
            const dtFim = new Date(ev.data_fim);
            const status = statusDoAgendamento(ev);
            const dataFormatada = dtIni.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
            const horaIni = dtIni.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const horaFim = dtFim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            html += `<div class="agendamento-linha status-${status}">
                <div class="info"><strong>${dataFormatada}</strong> · ${horaIni} às ${horaFim}</div>
                <button onclick="editarAgendamento(${ev.id})" title="Editar">✏️</button>
                <button class="excluir" onclick="excluirAgendamento(${ev.id})" title="Excluir">✕</button>
            </div>`;
        });
    }
    html += `<button class="tab-add-btn" onclick="abrirCriacaoAgendamentoDoNo()">+ Novo agendamento</button>`;
    container.innerHTML = html;
}
function abrirCriacaoAgendamento() {
    AGENDAMENTO_EDITANDO = null;
    AGENDAMENTO_CONTEXTO = { tipo: 'geral' };
    document.getElementById('modal-agendamento-titulo').innerText = 'Novo Agendamento';
    renderizarFormAgendamento(null, 'geral');
    document.getElementById('modal-agendamento').style.display = 'flex';
}
function abrirCriacaoAgendamentoDoNo() {
    if (!NO_ATUAL) return;
    AGENDAMENTO_EDITANDO = null;
    AGENDAMENTO_CONTEXTO = { tipo: 'no', noTipo: NO_ATUAL.tipo, noId: NO_ATUAL.id };
    document.getElementById('modal-agendamento-titulo').innerText = 'Novo Agendamento';
    renderizarFormAgendamento(null, 'no');
    document.getElementById('modal-agendamento').style.display = 'flex';
}
function editarAgendamento(id) {
    const ev = AGENDAMENTOS.find(a => a.id === id);
    if (!ev) return;
    AGENDAMENTO_EDITANDO = id;
    AGENDAMENTO_CONTEXTO = { tipo: 'geral' };
    document.getElementById('modal-agendamento-titulo').innerText = 'Editar Agendamento';
    renderizarFormAgendamento(ev, 'geral');
    document.getElementById('modal-agendamento').style.display = 'flex';
}
function renderizarFormAgendamento(ev, contexto) {
    let campos = '';
    if (contexto === 'geral') {
        let opts = '<option value="">— Escolha um tópico ou subtópico —</option>';
        ARVORE.forEach(plano => {
            plano.materias.forEach(mat => {
                mat.topicos.forEach(top => {
                    const nomeTop = `${top.numero || ''} ${top.nome}`.trim();
                    opts += `<optgroup label="${escapeAtributo(plano.nome)} › ${escapeAtributo(mat.nome)}">`;
                    const selTop = ev && ev.topico_id === top.id ? 'selected' : '';
                    opts += `<option value="top:${top.id}" ${selTop}>🔖 ${escapeHtml(nomeTop)}</option>`;
                    top.subtopicos.forEach(sub => {
                        const nomeSub = `${sub.numero || ''} ${sub.nome}`.trim();
                        const selSub = ev && ev.subtopico_id === sub.id ? 'selected' : '';
                        opts += `<option value="sub:${sub.id}" ${selSub}>  📄 ${escapeHtml(nomeSub)}</option>`;
                    });
                    opts += `</optgroup>`;
                });
            });
        });
        campos += `<label>Estudar</label><select id="ag-no">${opts}</select>`;
    } else {
        const nomeNo = `${NO_ATUAL.ref.numero || ''} ${NO_ATUAL.ref.nome}`.trim();
        campos += `<label>Estudando</label><input type="text" value="${escapeAtributo(nomeNo)}" disabled>`;
    }
    const hojeISO = new Date().toISOString().slice(0, 10);
    const dataVal = ev ? new Date(ev.data_inicio).toISOString().slice(0, 10) : hojeISO;
    campos += `<label>Data</label><input type="date" id="ag-data" value="${dataVal}">`;
    const horaIniVal = ev ? new Date(ev.data_inicio).toTimeString().slice(0, 5) : '14:00';
    const horaFimVal = ev ? new Date(ev.data_fim).toTimeString().slice(0, 5) : '15:00';
    campos += `<label>Hora de início</label><input type="time" id="ag-inicio" value="${horaIniVal}">`;
    campos += `<label>Hora de fim</label><input type="time" id="ag-fim" value="${horaFimVal}">`;
    document.getElementById('modal-agendamento-campos').innerHTML = campos;
}
function fecharModalAgendamento() {
    document.getElementById('modal-agendamento').style.display = 'none';
    AGENDAMENTO_EDITANDO = null;
    AGENDAMENTO_CONTEXTO = null;
}
async function confirmarModalAgendamento() {
    const contexto = AGENDAMENTO_CONTEXTO;
    let topico_id = null, subtopico_id = null;
    if (contexto.tipo === 'geral') {
        const noVal = document.getElementById('ag-no').value;
        if (!noVal) { mostrarToast('Escolha um nó', 'error'); return; }
        const [tipo, idStr] = noVal.split(':');
        if (tipo === 'top') topico_id = parseInt(idStr);
        else subtopico_id = parseInt(idStr);
    } else {
        if (contexto.noTipo === 'topico') topico_id = contexto.noId;
        else subtopico_id = contexto.noId;
    }
    const data = document.getElementById('ag-data').value;
    const horaIni = document.getElementById('ag-inicio').value;
    const horaFim = document.getElementById('ag-fim').value;
    if (!data || !horaIni || !horaFim) { mostrarToast('Preencha todos os campos', 'error'); return; }
    if (horaFim <= horaIni) { mostrarToast('Hora de fim deve ser depois do início', 'error'); return; }
    const data_inicio = `${data}T${horaIni}:00`;
    const data_fim = `${data}T${horaFim}:00`;
    const body = { data_inicio, data_fim };
    if (AGENDAMENTO_EDITANDO) {
        const resp = await apiFetch(`/api/estudos/agendamentos/${AGENDAMENTO_EDITANDO}`, {
            method: 'PATCH', body: JSON.stringify(body)
        });
        if (resp && resp.ok) {
            mostrarToast('Agendamento salvo!', 'success');
            fecharModalAgendamento();
            await carregarArvore();
            await carregarAgenda();
            if (MODO === 'agenda') renderizarAgenda();
        } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
    } else {
        if (topico_id) body.topico_id = topico_id;
        else body.subtopico_id = subtopico_id;
        const resp = await apiFetch('/api/estudos/agendamentos', { method: 'POST', body: JSON.stringify(body) });
        if (resp && resp.ok) {
            mostrarToast('Agendamento criado!', 'success');
            fecharModalAgendamento();
            await carregarArvore();
            await carregarAgenda();
            if (MODO === 'agenda') renderizarAgenda();
        } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
    }
}
async function excluirAgendamento(id) {
    if (!confirm('Excluir este agendamento?')) return;
    const resp = await apiFetch(`/api/estudos/agendamentos/${id}`, { method: 'DELETE' });
    if (resp && resp.ok) {
        mostrarToast('Agendamento excluído', 'success');
        await carregarArvore();
        await carregarAgenda();
        if (MODO === 'agenda') renderizarAgenda();
    } else if (resp) { const err = await resp.json(); mostrarToast(err.detail || 'Erro', 'error'); }
}