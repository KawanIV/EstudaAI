// ==========================================
// MAPA MENTAL (D3)
// ==========================================
function renderizarMapa() {
    const pct = calcularPorcentagemGeral();
    const hierarquia = {
        id: 'raiz', nome: USUARIO.nome, tipo: 'raiz', refId: null,
        status: statusGeral(), porcentagem: pct,
        children: ARVORE.map(plano => ({
            id: `plano-${plano.id}`, nome: plano.nome, tipo: 'plano', refId: plano.id,
            status: plano.status, porcentagem: plano.porcentagem,
            children: plano.materias.map(mat => ({
                id: `mat-${mat.id}`, nome: mat.nome, tipo: 'materia', refId: mat.id,
                status: mat.status, porcentagem: mat.porcentagem,
                children: mat.topicos.map(top => ({
                    id: `top-${top.id}`,
                    nome: `${top.numero || ''} ${top.nome}`.trim(),
                    tipo: 'topico', refId: top.id,
                    status: top.status, porcentagem: top.porcentagem,
                    children: top.subtopicos.map(sub => ({
                        id: `sub-${sub.id}`,
                        nome: `${sub.numero || ''} ${sub.nome}`.trim(),
                        tipo: 'subtopico', refId: sub.id,
                        status: sub.status, porcentagem: sub.porcentagem,
                    }))
                }))
            }))
        }))
    };

    const svgEl = document.getElementById('mapa-svg');
    d3.select(svgEl).selectAll('*').remove();
    const width = svgEl.clientWidth || 900;
    const height = svgEl.clientHeight || 600;

    svg = d3.select(svgEl).attr('viewBox', [0, 0, width, height]);
    g = svg.append('g');

    zoomBehavior = d3.zoom().scaleExtent([0.1, 3])
        .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoomBehavior);

    treeLayout = d3.tree()
        .size([height * 1.6, width - 200])
        .separation((a, b) => (a.parent === b.parent ? 1.8 : 2.2));

    root = d3.hierarchy(hierarquia, d => d.children);
    root.x0 = height / 2;
    root.y0 = 0;

    // ==========================================
    // COLAPSO FIXO: só os planos visíveis
    // ==========================================
    // Colapsa recursivamente TUDO abaixo da raiz.
    // Usa recursão explícita pra garantir que matérias/tópicos/subtópicos
    // também fiquem colapsados, independente de como foram criados.
    function colapsarRecursivo(no) {
        if (no.children) {
            no._children = no.children;
            no.children = null;
            no._children.forEach(colapsarRecursivo);
        }
        if (no._children) {
            no._children.forEach(colapsarRecursivo);
        }
    }

    if (root.children) {
        root.children.forEach(colapsarRecursivo);
    }

    atualizarMapa(root);

    // ==========================================
    // AUTO-FIT — ajusta o zoom pra caber tudo na tela
    // ==========================================
    setTimeout(() => autoAjustarZoom(), 150);
}

// ==========================================
// AUTO-FIT
// ==========================================
function autoAjustarZoom() {
    if (!g || !zoomBehavior || !svg) return;
    const svgEl = document.getElementById('mapa-svg');
    const bounds = g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const fullWidth = svgEl.clientWidth;
    const fullHeight = svgEl.clientHeight;
    const padding = 40;

    const scaleX = (fullWidth - padding * 2) / bounds.width;
    const scaleY = (fullHeight - padding * 2) / bounds.height;
    let scale = Math.min(scaleX, scaleY);

    scale = Math.min(scale, 1.2);
    scale = Math.max(scale, 0.15);

    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;

    const translateX = fullWidth / 2 - midX * scale;
    const translateY = fullHeight / 2 - midY * scale;

    svg.transition().duration(500).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
    );
}

// ==========================================
// COLAPSO POR NÓ
// ==========================================
function colapsarNo(d) {
    if (d.children) {
        d._children = d.children;
        d._children.forEach(colapsarNo);
        d.children = null;
    }
}

function quebrarTexto(texto, maxCharsPorLinha = 16, maxLinhas = 3) {
    if (!texto) return [''];
    const palavras = texto.split(/\s+/);
    const linhas = [];
    let linhaAtual = '';
    for (const palavra of palavras) {
        const tentativa = linhaAtual ? linhaAtual + ' ' + palavra : palavra;
        if (tentativa.length <= maxCharsPorLinha) linhaAtual = tentativa;
        else {
            if (linhaAtual) linhas.push(linhaAtual);
            linhaAtual = palavra;
            if (linhas.length === maxLinhas - 1) break;
        }
    }
    if (linhaAtual && linhas.length < maxLinhas) linhas.push(linhaAtual);
    if (linhas.length === maxLinhas) {
        const ultima = linhas[maxLinhas - 1];
        if (ultima.length > maxCharsPorLinha) {
            linhas[maxLinhas - 1] = ultima.slice(0, maxCharsPorLinha - 1) + '…';
        }
    }
    return linhas;
}

// ==========================================
// ATUALIZAR MAPA (redesenha após colapso/expansão)
// ==========================================
function atualizarMapa(source) {
    const svgEl = document.getElementById('mapa-svg');
    const height = svgEl.clientHeight || 600;
    const duration = 400;
    const treeData = treeLayout(root);
    const nodes = treeData.descendants();
    const links = treeData.links();

    nodes.forEach(d => { d.y = d.depth * 320; });

    // ----- LINKS -----
    const link = g.selectAll('path.link').data(links, d => d.target.id);
    const linkEnter = link.enter().insert('path', 'g')
        .attr('class', 'link')
        .attr('d', () => { const o = { x: source.x0, y: source.y0 }; return diagonal(o, o); });
    link.merge(linkEnter).transition().duration(duration).attr('d', d => diagonal(d.source, d.target));
    link.exit().transition().duration(duration)
        .attr('d', () => { const o = { x: source.x, y: source.y }; return diagonal(o, o); }).remove();

    // ----- NÓS -----
    const node = g.selectAll('g.node').data(nodes, d => d.id || (d.id = ++i));

    const nodeEnter = node.enter().append('g')
        .attr('class', d => {
            let cls = `node nivel-${d.data.tipo} status-${d.data.status || 'adicionado'}`;
            if (d.data.tipo === 'raiz') cls += ' raiz';
            if (NO_ATUAL && d.data.tipo === NO_ATUAL.tipo && d.data.refId === NO_ATUAL.id) cls += ' selecionado';
            return cls;
        })
        .attr('transform', () => `translate(${source.y0},${source.x0})`)
        .on('click', (event, d) => { event.stopPropagation(); clicarNo(d); })
        .on('contextmenu', (event, d) => {
            event.preventDefault();
            event.stopPropagation();
            if (d.data.tipo === 'raiz') abrirDropdownRaiz(event);
            else abrirDropdown(event, d.data.tipo, d.data.refId, d.data.status || 'adicionado');
        });

    nodeEnter.append('circle').attr('r', 1e-6);

    nodeEnter.each(function(d) {
        const linhas = quebrarTexto(d.data.nome, d.data.tipo === 'raiz' ? 16 : 14, 3);
        const textoEl = d3.select(this).append('text')
            .attr('class', 'nome-no').attr('text-anchor', 'middle').attr('x', 0);
        const dyInicial = d.data.tipo === 'raiz' ? '-2.4em' : '-3.5em';
        linhas.forEach((linha, idx) => {
            textoEl.append('tspan').attr('x', 0).attr('dy', idx === 0 ? dyInicial : '1.15em').text(linha);
        });
    });

    nodeEnter.append('text')
        .attr('class', 'porcentagem-no').attr('text-anchor', 'middle').attr('dy', '.35em')
        .text(d => `${d.data.porcentagem || 0}%`);

    const nodeUpdate = node.merge(nodeEnter);
    nodeUpdate.transition().duration(duration).attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select('circle')
        .attr('r', d => d.data.tipo === 'raiz' ? 28 : (d.data.tipo === 'plano' ? 18 : (d.data.tipo === 'materia' ? 15 : 13)));

    nodeUpdate.attr('class', d => {
        let cls = `node nivel-${d.data.tipo} status-${d.data.status || 'adicionado'}`;
        if (d.data.tipo === 'raiz') cls += ' raiz';
        if (NO_ATUAL && d.data.tipo === NO_ATUAL.tipo && d.data.refId === NO_ATUAL.id) cls += ' selecionado';
        return cls;
    });

    nodeUpdate.filter(d => d.data.tipo === 'raiz')
        .select('circle').style('fill', corDaRaiz()).style('stroke', corDaRaiz());

    nodeUpdate.select('text.porcentagem-no').text(d => `${d.data.porcentagem || 0}%`);

    node.exit().transition().duration(duration)
        .attr('transform', () => `translate(${source.y},${source.x})`).remove();

    nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
}

function diagonal(s, d) {
    const midY = (s.y + d.y) / 2;
    return `M ${s.y} ${s.x} C ${midY} ${s.x}, ${midY} ${d.x}, ${d.y} ${d.x}`;
}

// ==========================================
// CLIQUE EM NÓ
// ==========================================
function clicarNo(d) {
    if (d.data.tipo === 'raiz') return;

    if (d.data.tipo === 'subtopico') {
        NO_ATUAL = { tipo: 'subtopico', id: d.data.refId, ref: encontrarNo('subtopico', d.data.refId) };
        atualizarSelecaoVisual();
        renderizarConteudoDoNo();
    } else if (d.data.tipo === 'topico') {
        if (d.children) { d._children = d.children; d.children = null; }
        else if (d._children) { d.children = d._children; d._children = null; }
        NO_ATUAL = { tipo: 'topico', id: d.data.refId, ref: encontrarNo('topico', d.data.refId) };
        atualizarMapa(d);
        renderizarConteudoDoNo();
    } else if (d.data.tipo === 'materia') {
        if (d.children) { d._children = d.children; d.children = null; }
        else if (d._children) { d.children = d._children; d._children = null; }
        NO_ATUAL = { tipo: 'materia', id: d.data.refId, ref: encontrarNoMateria(d.data.refId) };
        atualizarMapa(d);
        renderizarConteudoDoNo();
    } else {
        // plano
        if (d.children) { d._children = d.children; d.children = null; }
        else if (d._children) { d.children = d._children; d._children = null; }
        atualizarMapa(d);
    }
}

function atualizarSelecaoVisual() {
    d3.selectAll('.node').classed('selecionado', function(d) {
        return NO_ATUAL && d.data.tipo === NO_ATUAL.tipo && d.data.refId === NO_ATUAL.id;
    });
}

// ==========================================
// CONTROLES DE ZOOM
// ==========================================
function zoomIn() { svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.4); }
function zoomOut() { svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7); }
function resetZoom() {
    // Re-renderiza do zero: volta ao estado inicial (só planos visíveis)
    renderizarMapa();
}

function expandirTudo() {
    root.each(d => {
        if (d._children) { d.children = d._children; d._children = null; }
    });
    atualizarMapa(root);
    setTimeout(() => autoAjustarZoom(), 450);
}

function colapsarTudo() {
    root.each(d => { if (d.depth >= 1 && d.children) { d._children = d.children; d.children = null; } });
    atualizarMapa(root);
    setTimeout(() => autoAjustarZoom(), 450);
}