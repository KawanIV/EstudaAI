// ==========================================
// LEITOR DE PDF — com ferramentas de anotação
// ==========================================

// ---------- Abrir / fechar ----------
async function abrirLeitor(materialId) {
    const material = MATERIAIS.find(m => m.id === materialId);
    if (!material) { mostrarToast('Material não encontrado', 'error'); return; }
    if (!material.url_arquivo) { mostrarToast('Esse material não tem arquivo', 'error'); return; }

    const ext = (material.url_arquivo.split('.').pop() || '').toLowerCase();
    if (ext !== 'pdf') { window.open(material.url_arquivo, '_blank'); return; }

    if (typeof pdfjsLib === 'undefined') {
        mostrarToast('Biblioteca PDF.js não carregou', 'error');
        return;
    }

    PDF_MATERIAL_ATUAL = material;
    PDF_PAGINA_ATUAL = 1;
    PDF_ZOOM = 1.0;
    PDF_MARCACOES = [];
    FERRAMENTA_ATUAL = 'navegar';
    COR_ATUAL = '#fff3a0';
    LEITOR_ABERTO = true;

    document.getElementById('leitor-overlay').style.display = 'flex';
    document.getElementById('leitor-titulo').innerText = '📖 ' + material.nome;
    document.getElementById('leitor-area').innerHTML = '<div class="leitor-loading">Carregando PDF...</div>';
    // Repõe a toolbar (que foi limpa pelo innerHTML acima)
    reporToolbarLeitor();
    atualizarFerramentaAtiva();

    try {
        // Carrega marcações salvas do backend
        await carregarMarcacoesBackend(material.id);
        PDF_DOC = await pdfjsLib.getDocument(material.url_arquivo).promise;

        // Restaura última página lida (se houver)
        const ultima = material.ultima_pagina || 1;
        PDF_PAGINA_ATUAL = (ultima >= 1 && ultima <= PDF_DOC.numPages) ? ultima : 1;

        document.getElementById('leitor-pagina-input').value = PDF_PAGINA_ATUAL;
        document.getElementById('leitor-pagina-total').innerText = '/ ' + PDF_DOC.numPages;

        // Renderiza barra de bookmarks
        renderizarBarraBookmarks();

        await renderizarPagina();
    } catch (err) {
        console.error('Erro ao abrir PDF:', err);
        document.getElementById('leitor-area').innerHTML = `
            <div class="leitor-erro">
                <h3>Não foi possível abrir o PDF</h3>
                <p style="margin-top:8px; font-size:0.9rem;">${escapeHtml(err.message || 'Erro desconhecido')}</p>
            </div>`;
    }
}

function reporToolbarLeitor() {
    const area = document.getElementById('leitor-area');
    if (!area) return;
    area.innerHTML = `
        <div class="leitor-toolbar" id="leitor-toolbar">
            <button data-ferramenta="navegar" class="ativo" onclick="mudarFerramenta('navegar')" title="Navegar">🖱️</button>
            <button data-ferramenta="retangulo" onclick="mudarFerramenta('retangulo')" title="Retângulo">▭</button>
            <button data-ferramenta="seta" onclick="mudarFerramenta('seta')" title="Seta">↗</button>
            <button data-ferramenta="bookmark" onclick="mudarFerramenta('bookmark')" title="Bookmark">🔖</button>
            <button data-ferramenta="nota" onclick="mudarFerramenta('nota')" title="Nota">📝</button>
            <div class="separador"></div>
            <div class="cores" id="leitor-toolbar-cores">
                <div class="cor-bola ativa" data-cor="#fff3a0" style="background:#fff3a0" onclick="escolherCor('#fff3a0')" title="Amarelo"></div>
                <div class="cor-bola" data-cor="#b8e994" style="background:#b8e994" onclick="escolherCor('#b8e994')" title="Verde"></div>
                <div class="cor-bola" data-cor="#a0d8ff" style="background:#a0d8ff" onclick="escolherCor('#a0d8ff')" title="Azul"></div>
                <div class="cor-bola" data-cor="#ffb8d4" style="background:#ffb8d4" onclick="escolherCor('#ffb8d4')" title="Rosa"></div>
                <div class="cor-bola" data-cor="#ffd4a0" style="background:#ffd4a0" onclick="escolherCor('#ffd4a0')" title="Laranja"></div>
            </div>
            <div class="separador"></div>
            <button onclick="limparMarcacoesDaPagina()" title="Limpar marcações desta página">🗑️</button>
            <button onclick="toggleBarraBookmarks()" title="Bookmarks" id="btn-toggle-bookmarks">📑</button>
        </div>
        <div class="leitor-loading">Carregando PDF...</div>
    `;
}

async function fecharLeitor() {
    // Salva a última página antes de fechar
    if (PDF_MATERIAL_ATUAL && PDF_PAGINA_ATUAL > 0) {
        try {
            const materialNaLista = MATERIAIS.find(m => m.id === PDF_MATERIAL_ATUAL.id);
            if (materialNaLista) materialNaLista.ultima_pagina = PDF_PAGINA_ATUAL;

            await apiFetch(`/api/estudos/materiais/${PDF_MATERIAL_ATUAL.id}/ultima-pagina`, {
                method: 'PATCH',
                body: JSON.stringify({ ultima_pagina: PDF_PAGINA_ATUAL })
            });
        } catch (e) {
            console.error('Erro ao salvar última página:', e);
        }
    }

    LEITOR_ABERTO = false;
    PDF_DOC = null;
    PDF_MATERIAL_ATUAL = null;
    PDF_MARCACOES = [];
    fecharBarraSelecao();
    fecharPopupNota();
    fecharPopupBookmark();
    document.getElementById('leitor-overlay').style.display = 'none';
    document.getElementById('leitor-area').innerHTML = '';
    document.getElementById('leitor-bookmarks').style.display = 'none';
}

// ---------- Ferramentas ----------
function mudarFerramenta(nome) {
    FERRAMENTA_ATUAL = nome;
    atualizarFerramentaAtiva();
    const area = document.getElementById('leitor-area');
    if (!area) return;
    area.className = 'leitor-area';
    if (nome !== 'navegar') area.classList.add('ferramenta-' + nome);
}

function atualizarFerramentaAtiva() {
    document.querySelectorAll('#leitor-toolbar button[data-ferramenta]').forEach(b => {
        b.classList.toggle('ativo', b.dataset.ferramenta === FERRAMENTA_ATUAL);
    });
}

function escolherCor(cor) {
    COR_ATUAL = cor;
    document.querySelectorAll('#leitor-toolbar .cor-bola').forEach(b => {
        b.classList.toggle('ativa', b.dataset.cor === cor);
    });
}

// ---------- Renderizar página ----------
async function renderizarPagina() {
    if (!PDF_DOC || PDF_RENDERIZANDO) return;
    PDF_RENDERIZANDO = true;

    const area = document.getElementById('leitor-area');
    const canvasAntigo = document.getElementById('leitor-canvas-wrap');
    if (canvasAntigo) canvasAntigo.remove();
    const loadingAntigo = area.querySelector('.leitor-loading');
    if (loadingAntigo) loadingAntigo.remove();

    const loading = document.createElement('div');
    loading.className = 'leitor-loading';
    loading.innerText = 'Carregando página...';
    area.appendChild(loading);

    try {
        const page = await PDF_DOC.getPage(PDF_PAGINA_ATUAL);
        const viewport = page.getViewport({ scale: 1.5 * PDF_ZOOM });

        const wrap = document.createElement('div');
        wrap.className = 'leitor-canvas-wrap';
        wrap.id = 'leitor-canvas-wrap';
        wrap.style.width = viewport.width + 'px';
        wrap.style.height = viewport.height + 'px';

        // Canvas (imagem do PDF)
        const canvas = document.createElement('canvas');
        canvas.className = 'leitor-canvas';
        canvas.id = 'leitor-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        wrap.appendChild(canvas);

        // Camada de texto (invisível, permite seleção)
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.id = 'textLayer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        wrap.appendChild(textLayerDiv);

        // Overlay de marcações
        const overlay = document.createElement('div');
        overlay.className = 'marcacao-overlay';
        overlay.id = 'marcacao-overlay';
        wrap.appendChild(overlay);

        loading.remove();
        area.appendChild(wrap);

        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        // Renderiza a camada de texto
        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: [],
        }).promise;

        PDF_VIEWPORT_ATUAL = viewport;
        desenharMarcacoesDaPagina();
        anexarEventosPagina(canvas, wrap);
        atualizarControles();
    } catch (err) {
        console.error('Erro ao renderizar página:', err);
        loading.innerText = 'Erro ao renderizar página ' + PDF_PAGINA_ATUAL;
    } finally {
        PDF_RENDERIZANDO = false;
    }
}

function atualizarControles() {
    const input = document.getElementById('leitor-pagina-input');
    const total = document.getElementById('leitor-pagina-total');
    const zoomLabel = document.getElementById('leitor-zoom-label');
    const btnPrev = document.getElementById('leitor-btn-prev');
    const btnNext = document.getElementById('leitor-btn-next');

    if (input) input.value = PDF_PAGINA_ATUAL;
    if (total) total.innerText = '/ ' + (PDF_DOC ? PDF_DOC.numPages : '?');
    if (zoomLabel) zoomLabel.innerText = Math.round(PDF_ZOOM * 100) + '%';
    if (btnPrev) btnPrev.disabled = PDF_PAGINA_ATUAL <= 1;
    if (btnNext) btnNext.disabled = !PDF_DOC || PDF_PAGINA_ATUAL >= PDF_DOC.numPages;
}

// ---------- Navegação ----------
function leitorAnterior() {
    if (PDF_PAGINA_ATUAL > 1) {
        PDF_PAGINA_ATUAL--;
        fecharBarraSelecao();
        renderizarPagina();
    }
}

function leitorProximo() {
    if (PDF_DOC && PDF_PAGINA_ATUAL < PDF_DOC.numPages) {
        PDF_PAGINA_ATUAL++;
        fecharBarraSelecao();
        renderizarPagina();
    }
}

function leitorIrPara(valor) {
    const n = parseInt(valor);
    if (!PDF_DOC || isNaN(n) || n < 1 || n > PDF_DOC.numPages) { atualizarControles(); return; }
    PDF_PAGINA_ATUAL = n;
    fecharBarraSelecao();
    renderizarPagina();
}

function leitorZoomIn() {
    PDF_ZOOM = Math.min(PDF_ZOOM * 1.25, 3.0);
    fecharBarraSelecao();
    renderizarPagina();
}

function leitorZoomOut() {
    PDF_ZOOM = Math.max(PDF_ZOOM / 1.25, 0.3);
    fecharBarraSelecao();
    renderizarPagina();
}

// ---------- Eventos de interação com a página ----------
function anexarEventosPagina(canvas, wrap) {
    // Clique na página (retângulo / seta / bookmark / nota)
    wrap.addEventListener('mousedown', (e) => {
        if (FERRAMENTA_ATUAL === 'navegar') return;
        if (e.button !== 0) return;
        e.preventDefault();

        const rect = wrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (FERRAMENTA_ATUAL === 'bookmark') {
            criarMarcacaoLocal({
                tipo: 'bookmark',
                pagina: PDF_PAGINA_ATUAL,
                cor: null,
                dados: {},
            });
            return;
        }

        if (FERRAMENTA_ATUAL === 'nota') {
            abrirPopupNota(x, y);
            return;
        }

        if (FERRAMENTA_ATUAL === 'retangulo') {
            iniciarRetangulo(x, y, wrap);
            return;
        }

        if (FERRAMENTA_ATUAL === 'seta') {
            iniciarSeta(x, y, wrap);
            return;
        }
    });

    // Seleção de texto → mostra barrinha de cores
    wrap.addEventListener('mouseup', () => {
        setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !sel.toString().trim()) {
                fecharBarraSelecao();
                return;
            }
            // Confere se a seleção está dentro do wrap
            if (!wrap.contains(sel.anchorNode)) { fecharBarraSelecao(); return; }
            mostrarBarraSelecao(sel, wrap);
        }, 10);
    });

    // Clique fora de seleção limpa a barrinha
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.barra-selecao') && !e.target.closest('.leitor-canvas-wrap')) {
            fecharBarraSelecao();
        }
    }, { capture: true });
}

// ---------- Retângulo ----------
let RET_TEMP = null;

function iniciarRetangulo(xInicial, yInicial, wrap) {
    RET_TEMP = { x: xInicial, y: yInicial, wrap };

    const div = document.createElement('div');
    div.className = 'marcacao-temp';
    div.id = 'ret-temp';
    div.style.left = xInicial + 'px';
    div.style.top = yInicial + 'px';
    wrap.appendChild(div);

    const moveHandler = (e) => {
        if (!RET_TEMP) return;
        const rect = wrap.getBoundingClientRect();
        const xAtual = e.clientX - rect.left;
        const yAtual = e.clientY - rect.top;
        const x = Math.min(xInicial, xAtual);
        const y = Math.min(yInicial, yAtual);
        const w = Math.abs(xAtual - xInicial);
        const h = Math.abs(yAtual - yInicial);
        const el = document.getElementById('ret-temp');
        if (el) {
            el.style.left = x + 'px'; el.style.top = y + 'px';
            el.style.width = w + 'px'; el.style.height = h + 'px';
        }
    };

    const upHandler = (e) => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        const el = document.getElementById('ret-temp');
        if (el) {
            const w = parseFloat(el.style.width) || 0;
            const h = parseFloat(el.style.height) || 0;
            if (w > 5 && h > 5) {
                criarMarcacaoLocal({
                    tipo: 'retangulo',
                    pagina: PDF_PAGINA_ATUAL,
                    cor: COR_ATUAL,
                    dados: {
                        x: parseFloat(el.style.left),
                        y: parseFloat(el.style.top),
                        w: w, h: h,
                        vw: wrap.clientWidth, vh: wrap.clientHeight,
                    },
                });
            }
            el.remove();
        }
        RET_TEMP = null;
    };

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
}

// ---------- Seta ----------
let SETA_TEMP = null;

function iniciarSeta(xInicial, yInicial, wrap) {
    SETA_TEMP = { x: xInicial, y: yInicial, wrap };

    // Cria SVG temporário
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'marcacao-temp');
    svg.id = 'seta-temp';
    svg.style.left = '0'; svg.style.top = '0';
    svg.style.width = '100%'; svg.style.height = '100%';
    svg.style.background = 'transparent';
    wrap.appendChild(svg);

    const moveHandler = (e) => {
        if (!SETA_TEMP) return;
        const rect = wrap.getBoundingClientRect();
        const xAtual = e.clientX - rect.left;
        const yAtual = e.clientY - rect.top;
        svg.innerHTML = setaSVG(xInicial, yInicial, xAtual, yAtual, COR_ATUAL);
    };

    const upHandler = (e) => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        const rect = wrap.getBoundingClientRect();
        const xFim = e.clientX - rect.left;
        const yFim = e.clientY - rect.top;
        svg.remove();

        const dx = xFim - xInicial;
        const dy = yFim - yInicial;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            criarMarcacaoLocal({
                tipo: 'seta',
                pagina: PDF_PAGINA_ATUAL,
                cor: COR_ATUAL,
                dados: {
                    x1: xInicial, y1: yInicial,
                    x2: xFim, y2: yFim,
                    vw: wrap.clientWidth, vh: wrap.clientHeight,
                },
            });
        }
        SETA_TEMP = null;
    };

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
}

function setaSVG(x1, y1, x2, y2, cor) {
    // Desenha linha + triângulo na ponta
    const angulo = Math.atan2(y2 - y1, x2 - x1);
    const tam = 12;
    const x3 = x2 - tam * Math.cos(angulo - Math.PI / 6);
    const y3 = y2 - tam * Math.sin(angulo - Math.PI / 6);
    const x4 = x2 - tam * Math.cos(angulo + Math.PI / 6);
    const y4 = y2 - tam * Math.sin(angulo + Math.PI / 6);

    return `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${cor}" stroke-width="3" stroke-linecap="round"/>
        <polygon points="${x2},${y2} ${x3},${y3} ${x4},${y4}" fill="${cor}" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>
    `;
}

// ---------- Grifar (seleção de texto) ----------
function mostrarBarraSelecao(sel, wrap) {
    fecharBarraSelecao();

    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (!rects.length) return;

    // Salva os rects em coordenadas relativas ao wrap
    const wrapRect = wrap.getBoundingClientRect();
    const rectsRelativos = [];
    for (const r of rects) {
        rectsRelativos.push({
            x: r.left - wrapRect.left,
            y: r.top - wrapRect.top,
            w: r.width,
            h: r.height,
        });
    }

    // Posição da barrinha: acima do primeiro rect
    const primeira = rects[0];
    const barra = document.createElement('div');
    barra.className = 'barra-selecao';
    barra.id = 'barra-selecao';
    barra.innerHTML = `
        <div class="cor-bola" style="background:#fff3a0" onclick="aplicarGrifo('#fff3a0')" title="Amarelo"></div>
        <div class="cor-bola" style="background:#b8e994" onclick="aplicarGrifo('#b8e994')" title="Verde"></div>
        <div class="cor-bola" style="background:#a0d8ff" onclick="aplicarGrifo('#a0d8ff')" title="Azul"></div>
        <div class="cor-bola" style="background:#ffb8d4" onclick="aplicarGrifo('#ffb8d4')" title="Rosa"></div>
        <div class="cor-bola" style="background:#ffd4a0" onclick="aplicarGrifo('#ffd4a0')" title="Laranja"></div>
    `;

    // Coordenadas relativas ao overlay (que é o wrap)
    barra.style.left = (primeira.left - wrapRect.left) + 'px';
    barra.style.top = Math.max(0, primeira.top - wrapRect.top - 46) + 'px';

    wrap.appendChild(barra);
    BARRA_SELECAO_RECTS = rectsRelativos;
}

function aplicarGrifo(cor) {
    if (!BARRA_SELECAO_RECTS || !BARRA_SELECAO_RECTS.length) return;

    criarMarcacaoLocal({
        tipo: 'grifo',
        pagina: PDF_PAGINA_ATUAL,
        cor: cor,
        dados: {
            rects: BARRA_SELECAO_RECTS,
            vw: document.getElementById('leitor-canvas-wrap').clientWidth,
            vh: document.getElementById('leitor-canvas-wrap').clientHeight,
        },
    });

    fecharBarraSelecao();
    window.getSelection().removeAllRanges();
}

function fecharBarraSelecao() {
    const b = document.getElementById('barra-selecao');
    if (b) b.remove();
    BARRA_SELECAO_RECTS = null;
}

// ---------- Nota ----------
let NOTA_POSICAO_TEMP = null;

function abrirPopupNota(x, y) {
    NOTA_POSICAO_TEMP = { x, y };
    document.getElementById('nota-popup-texto').value = '';
    document.getElementById('nota-popup').style.display = 'flex';
    setTimeout(() => document.getElementById('nota-popup-texto').focus(), 50);
}

function fecharPopupNota() {
    document.getElementById('nota-popup').style.display = 'none';
    NOTA_POSICAO_TEMP = null;
}

function salvarPopupNota() {
    const texto = document.getElementById('nota-popup-texto').value.trim();
    if (!texto) { mostrarToast('Escreva algo na nota', 'error'); return; }
    const wrap = document.getElementById('leitor-canvas-wrap');
    if (!wrap || !NOTA_POSICAO_TEMP) { fecharPopupNota(); return; }

    criarMarcacaoLocal({
        tipo: 'nota',
        pagina: PDF_PAGINA_ATUAL,
        cor: null,
        dados: {
            x: NOTA_POSICAO_TEMP.x,
            y: NOTA_POSICAO_TEMP.y,
            texto: texto,
            vw: wrap.clientWidth,
            vh: wrap.clientHeight,
        },
    });
    fecharPopupNota();
}

// ---------- Criar / desenhar marcações ----------
async function criarMarcacaoLocal(marcacao) {
    const salva = await salvarMarcacaoBackend(marcacao);
    if (!salva) {
        mostrarToast('Erro ao salvar marcação', 'error');
        return;
    }
    PDF_MARCACOES.push({
        id: salva.id,
        tipo: salva.tipo,
        pagina: salva.pagina,
        cor: salva.cor,
        dados: salva.dados,
        criado_em: salva.criado_em,
    });
    desenharMarcacoesDaPagina();
    // Só mostra toast pra marcações visuais (não bookmark)
    if (marcacao.tipo !== 'bookmark') {
        mostrarToast('Marcação salva!', 'success');
    } else {
        mostrarToast('Bookmark criado', 'success');
    }
}

function desenharMarcacoesDaPagina() {
    const overlay = document.getElementById('marcacao-overlay');
    const wrap = document.getElementById('leitor-canvas-wrap');
    if (!overlay || !wrap) return;

    overlay.innerHTML = '';

    const marcacoes = PDF_MARCACOES.filter(m => m.pagina === PDF_PAGINA_ATUAL);

    marcacoes.forEach(m => {
        const dados = typeof m.dados === 'string' ? JSON.parse(m.dados) : m.dados;

        if (m.tipo === 'grifo') {
            const escalaX = wrap.clientWidth / (dados.vw || wrap.clientWidth);
            const escalaY = wrap.clientHeight / (dados.vh || wrap.clientHeight);
            dados.rects.forEach(r => {
                const el = document.createElement('div');
                el.className = 'marcacao-grifo';
                el.style.left = (r.x * escalaX) + 'px';
                el.style.top = (r.y * escalaY) + 'px';
                el.style.width = (r.w * escalaX) + 'px';
                el.style.height = (r.h * escalaY) + 'px';
                el.style.background = m.cor || '#fff3a0';
                el.title = 'Clique pra remover';
                el.onclick = () => removerMarcacaoLocal(m.id);
                overlay.appendChild(el);
            });
        } else if (m.tipo === 'retangulo') {
            const escalaX = wrap.clientWidth / (dados.vw || wrap.clientWidth);
            const escalaY = wrap.clientHeight / (dados.vh || wrap.clientHeight);
            const el = document.createElement('div');
            el.className = 'marcacao-retangulo';
            el.style.left = (dados.x * escalaX) + 'px';
            el.style.top = (dados.y * escalaY) + 'px';
            el.style.width = (dados.w * escalaX) + 'px';
            el.style.height = (dados.h * escalaY) + 'px';
            el.style.borderColor = m.cor || '#fff3a0';
            el.title = 'Clique pra remover';
            el.onclick = () => removerMarcacaoLocal(m.id);
            overlay.appendChild(el);
        } else if (m.tipo === 'seta') {
            const escalaX = wrap.clientWidth / (dados.vw || wrap.clientWidth);
            const escalaY = wrap.clientHeight / (dados.vh || wrap.clientHeight);
            const div = document.createElement('div');
            div.className = 'marcacao-seta';
            div.style.left = '0'; div.style.top = '0';
            div.style.width = '100%'; div.style.height = '100%';
            div.innerHTML = `<svg style="width:100%; height:100%;">${setaSVG(dados.x1 * escalaX, dados.y1 * escalaY, dados.x2 * escalaX, dados.y2 * escalaY, m.cor || '#fff3a0')}</svg>`;
            div.title = 'Clique pra remover';
            div.onclick = () => removerMarcacaoLocal(m.id);
            overlay.appendChild(div);
        } else if (m.tipo === 'nota') {
            const escalaX = wrap.clientWidth / (dados.vw || wrap.clientWidth);
            const escalaY = wrap.clientHeight / (dados.vh || wrap.clientHeight);
            const el = document.createElement('div');
            el.className = 'marcacao-nota';
            el.style.left = (dados.x * escalaX) + 'px';
            el.style.top = (dados.y * escalaY) + 'px';
            el.innerHTML = `📝<div class="texto-popover">${escapeHtml(dados.texto || '')}</div>`;
            el.title = 'Clique com botão direito pra remover';
            el.onclick = (ev) => { ev.stopPropagation(); };
            el.oncontextmenu = (ev) => { ev.preventDefault(); removerMarcacaoLocal(m.id); };
            overlay.appendChild(el);
        }
        // bookmark não desenha (fica só na barra de bookmarks — futura)
    });
}

async function removerMarcacaoLocal(id) {
    // Se for ID local (improvável agora), só remove da memória
    if (typeof id === 'string' && id.startsWith('__local_')) {
        PDF_MARCACOES = PDF_MARCACOES.filter(m => m.id !== id);
        desenharMarcacoesDaPagina();
        return;
    }
    // Deleta no backend
    const ok = await deletarMarcacaoBackend(id);
    if (ok) {
        PDF_MARCACOES = PDF_MARCACOES.filter(m => m.id !== id);
        desenharMarcacoesDaPagina();
        mostrarToast('Marcação removida', 'success');
    } else {
        mostrarToast('Erro ao remover marcação', 'error');
    }
}

async function limparMarcacoesDaPagina() {
    const daPagina = PDF_MARCACOES.filter(m => m.pagina === PDF_PAGINA_ATUAL);
    if (!daPagina.length) {
        mostrarToast('Nenhuma marcação nesta página', 'info');
        return;
    }
    if (!confirm(`Remover todas as ${daPagina.length} marcações desta página?`)) return;

    // Deleta todas no backend
    for (const m of daPagina) {
        await deletarMarcacaoBackend(m.id);
    }
    PDF_MARCACOES = PDF_MARCACOES.filter(m => m.pagina !== PDF_PAGINA_ATUAL);
    desenharMarcacoesDaPagina();
    mostrarToast(`${daPagina.length} marcações removidas`, 'success');
}

// ---------- Fechar com ESC / navegação com setas ----------
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && LEITOR_ABERTO) {
        if (document.getElementById('nota-popup').style.display !== 'none') {
            fecharPopupNota();
        } else if (document.getElementById('bookmark-popup').style.display !== 'none') {
            fecharPopupBookmark();
        } else {
            fecharLeitor();
        }
    } else if (LEITOR_ABERTO) {
        if (document.getElementById('nota-popup').style.display !== 'none') return;
        if (document.getElementById('bookmark-popup').style.display !== 'none') return;
        if (e.key === 'ArrowLeft') leitorAnterior();
        else if (e.key === 'ArrowRight') leitorProximo();
    }
});

// ==========================================
// PERSISTÊNCIA NO BACKEND
// ==========================================
async function carregarMarcacoesBackend(materialId) {
    const resp = await apiFetch(`/api/estudos/materiais/${materialId}/marcacoes`);
    if (!resp) { PDF_MARCACOES = []; return; }
    const lista = await resp.json();
    PDF_MARCACOES = lista.map(m => ({
        id: m.id,
        tipo: m.tipo,
        pagina: m.pagina,
        cor: m.cor,
        dados: m.dados,   // string JSON — vamos fazer parse quando usar
        criado_em: m.criado_em,
    }));
}

async function salvarMarcacaoBackend(marcacao) {
    const body = {
        material_id: PDF_MATERIAL_ATUAL.id,
        tipo: marcacao.tipo,
        pagina: marcacao.pagina,
        cor: marcacao.cor,
        dados: JSON.stringify(marcacao.dados),
    };
    const resp = await apiFetch('/api/estudos/marcacoes', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        const salva = await resp.json();
        return salva;   // retorna com ID do backend
    }
    return null;
}

async function deletarMarcacaoBackend(marcacaoId) {
    const resp = await apiFetch(`/api/estudos/marcacoes/${marcacaoId}`, { method: 'DELETE' });
    return resp && resp.ok;
}

// ==========================================
// BARRA DE BOOKMARKS
// ==========================================
function toggleBarraBookmarks() {
    const barra = document.getElementById('leitor-bookmarks');
    const visivel = barra.style.display !== 'none';
    barra.style.display = visivel ? 'none' : 'flex';
    if (!visivel) renderizarBarraBookmarks();
}

function renderizarBarraBookmarks() {
    const lista = document.getElementById('leitor-bookmarks-lista');
    if (!lista) return;

    const bookmarks = PDF_MARCACOES
        .filter(m => m.tipo === 'bookmark')
        .sort((a, b) => a.pagina - b.pagina);

    if (!bookmarks.length) {
        lista.innerHTML = `<div class="leitor-bookmarks-vazio">Nenhum bookmark ainda.<br>Clique em <strong>+</strong> pra criar.</div>`;
        return;
    }

    lista.innerHTML = bookmarks.map(b => {
        const dados = typeof b.dados === 'string' ? JSON.parse(b.dados || '{}') : (b.dados || {});
        const nome = dados.nome || `Página ${b.pagina}`;
        return `<div class="leitor-bookmark-item" onclick="irParaBookmark(${b.pagina})">
            <div class="info">
                <div class="nome">${escapeHtml(nome)}</div>
                <div class="pagina-label">📄 Página ${b.pagina}</div>
            </div>
            <div class="acoes">
                <button onclick="event.stopPropagation(); abrirEditarBookmark(${b.id}, '${escapeAtributo(nome)}')" title="Renomear">✏️</button>
                <button class="excluir" onclick="event.stopPropagation(); removerBookmark(${b.id})" title="Excluir">✕</button>
            </div>
        </div>`;
    }).join('');
}

function irParaBookmark(pagina) {
    if (!PDF_DOC) return;
    if (pagina < 1 || pagina > PDF_DOC.numPages) return;
    PDF_PAGINA_ATUAL = pagina;
    renderizarPagina();
}

function criarBookmarkPaginaAtual() {
    if (!PDF_DOC) return;
    // Cria bookmark direto na página atual, com nome padrão
    const nome = `Página ${PDF_PAGINA_ATUAL}`;
    criarMarcacaoLocal({
        tipo: 'bookmark',
        pagina: PDF_PAGINA_ATUAL,
        cor: null,
        dados: { nome: nome },
    }).then(() => {
        renderizarBarraBookmarks();
    });
}

// ---------- Popup de editar nome ----------
let BOOKMARK_EDITANDO_ID = null;

function abrirEditarBookmark(id, nomeAtual) {
    BOOKMARK_EDITANDO_ID = id;
    document.getElementById('bookmark-popup-titulo').innerText = 'Renomear bookmark';
    document.getElementById('bookmark-popup-input').value = nomeAtual;
    document.getElementById('bookmark-popup').style.display = 'flex';
    setTimeout(() => {
        const inp = document.getElementById('bookmark-popup-input');
        inp.focus();
        inp.select();
    }, 50);
}

function fecharPopupBookmark() {
    document.getElementById('bookmark-popup').style.display = 'none';
    BOOKMARK_EDITANDO_ID = null;
}

async function salvarPopupBookmark() {
    const nome = document.getElementById('bookmark-popup-input').value.trim();
    if (!BOOKMARK_EDITANDO_ID) { fecharPopupBookmark(); return; }

    const bookmark = PDF_MARCACOES.find(m => m.id === BOOKMARK_EDITANDO_ID);
    if (!bookmark) { fecharPopupBookmark(); return; }

    const dados = typeof bookmark.dados === 'string' ? JSON.parse(bookmark.dados || '{}') : (bookmark.dados || {});
    dados.nome = nome || `Página ${bookmark.pagina}`;

    // Salva no backend
    const resp = await apiFetch(`/api/estudos/marcacoes/${bookmark.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dados: JSON.stringify(dados) })
    });

    if (resp && resp.ok) {
        bookmark.dados = JSON.stringify(dados);
        mostrarToast('Bookmark atualizado', 'success');
        renderizarBarraBookmarks();
    } else {
        mostrarToast('Erro ao renomear bookmark', 'error');
    }
    fecharPopupBookmark();
}

async function removerBookmark(id) {
    if (!confirm('Remover este bookmark?')) return;
    const ok = await deletarMarcacaoBackend(id);
    if (ok) {
        PDF_MARCACOES = PDF_MARCACOES.filter(m => m.id !== id);
        renderizarBarraBookmarks();
        desenharMarcacoesDaPagina();
        mostrarToast('Bookmark removido', 'success');
    } else {
        mostrarToast('Erro ao remover bookmark', 'error');
    }
}