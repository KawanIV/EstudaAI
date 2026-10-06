// ==========================================
// ESTADO GLOBAL
// ==========================================
let USUARIO = null;
let ARVORE = [];
let CATEGORIAS = [];
let TIPOS_MATERIAL = [];
let MATERIAIS = [];
let MATERIAIS_FILTROS = { nome: '', materia_nome: '', tipo_nome: '', url_link: '', url_arquivo: '' };
let MATERIAIS_ORDEM = { campo: 'criado_em', direcao: 'desc' };
let MATERIAIS_EDITANDO = null;
let PLANO_ATUAL = null;
let NO_ATUAL = null;
let TIPO_CRIACAO = null;
let CONTEXTO_CRIACAO = null;
let TIPO_CONTEUDO = null;
let CONTEUDO_EDITANDO = null;
let CONTEUDO_EDITANDO_ARQUIVO = false;
let MODO = 'mapa';
let EDITANDO = null;
let CATEGORIA_VOLTAR_PARA_MODAL = false;
let TIPO_VOLTAR_PARA_MODAL = false;
let TIPO_ATIVIDADE_VOLTAR_PARA_MODAL = false;
let ATIVIDADES = [];
let TIPOS_ATIVIDADE = [];
let ATIVIDADE_EDITANDO = null;
let ANEXOS_REMOVER = new Set();
let NOS_EXPANDIDOS = new Set();
let svg, g, zoomBehavior, treeLayout, root;
let i = 0;
// Leitor de PDF
let LEITOR_ABERTO = false;
let PDF_DOC = null;
let PDF_MATERIAL_ATUAL = null;
let PDF_PAGINA_ATUAL = 1;
let PDF_ZOOM = 1.0;
let PDF_RENDERIZANDO = false;
let PDF_MARCACOES = [];
// Leitor de PDF — ferramentas
let NOTA_PAGINA_ATUAL = '';
let NOTA_DEBOUNCE_TIMER = null;
let NOTA_EDITANDO = false;
let FERRAMENTA_ATUAL = 'navegar';      // navegar | retangulo | seta | bookmark | nota
let COR_ATUAL = '#fff3a0';
let BARRA_SELECAO_RECTS = null;
let PDF_VIEWPORT_ATUAL = null;

// Agenda
let AGENDA_VIEW = 'mensal';
let AGENDA_DATA_REF = new Date();
let AGENDAMENTOS = [];
let AGENDAMENTO_EDITANDO = null;
let AGENDAMENTO_CONTEXTO = null;

// Atividades - lista geral
let ATIVIDADES_VIEW = 'lista';
let ATIVIDADES_FILTROS = { nome: '', tipo_nome: '', status: '', materia_nome: '', node_nome: '' };
let ATIVIDADES_ORDEM = { campo: 'data_entrega', direcao: 'asc' };

// Markdown - conteúdos com cru visível
let CONTEUDOS_MD_CRU = new Set();

// Drag and drop kanban
let kanbanDragId = null;

// Dropdown aberto
let dropdownAberto = null;

const CORES_DISPONIVEIS = [
    { hex: '#8e44ad', nome: 'Roxo' },
    { hex: '#d4af37', nome: 'Dourado' },
    { hex: '#2980b9', nome: 'Azul' },
    { hex: '#27ae60', nome: 'Verde' },
    { hex: '#e74c3c', nome: 'Vermelho' },
    { hex: '#e91e63', nome: 'Rosa' },
];

// ==========================================
// API
// ==========================================
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    const headers = options.headers || {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const resp = await fetch(url, { ...options, headers });

    if (resp.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.href = '/index.html';
        return null;
    }

    if (resp.status === 204) return null;
    return resp;
}

// ==========================================
// HELPERS
// ==========================================
function escapeHtml(texto) {
    if (texto == null) return '';
    return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function escapeAtributo(texto) {
    if (texto == null) return '';
    return String(texto).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncar(texto, max) {
    if (!texto) return '';
    return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
}

function mostrarToast(mensagem, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// MARKDOWN
// ==========================================
function renderizarMarkdown(texto) {
    if (!texto) return '';
    if (typeof marked === 'undefined') {
        return `<p>${escapeHtml(texto).replace(/\n/g, '<br>')}</p>`;
    }
    try {
        return marked.parse(texto, { breaks: true, gfm: true });
    } catch (e) {
        return `<p>${escapeHtml(texto).replace(/\n/g, '<br>')}</p>`;
    }
}

function toggleMarkdownCru(conteudoId) {
    if (CONTEUDOS_MD_CRU.has(conteudoId)) {
        CONTEUDOS_MD_CRU.delete(conteudoId);
    } else {
        CONTEUDOS_MD_CRU.add(conteudoId);
    }
    if (NO_ATUAL && NO_ATUAL.ref) {
        renderizarConteudos(NO_ATUAL.ref, NO_ATUAL.tipo);
    }
}

// ==========================================
// MAPA - helpers de cálculo
// ==========================================
function corDaRaiz() {
    return (USUARIO && USUARIO.cor_raiz) || '#8e44ad';
}

function calcularPorcentagemGeral() {
    let total = 0, concluidos = 0;
    ARVORE.forEach(plano => {
        plano.materias.forEach(mat => {
            mat.topicos.forEach(top => {
                top.subtopicos.forEach(sub => {
                    total++;
                    if (sub.status === 'concluido') concluidos++;
                });
            });
        });
    });
    if (total === 0) return 0;
    return Math.round((concluidos / total) * 100);
}

function statusGeral() {
    const pct = calcularPorcentagemGeral();
    if (pct === 0) return 'adicionado';
    if (pct === 100) return 'concluido';
    return 'em_estudo';
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

function diagonal(s, d) {
    const midY = (s.y + d.y) / 2;
    return `M ${s.y} ${s.x} C ${midY} ${s.x}, ${midY} ${d.x}, ${d.y} ${d.x}`;
}

// ==========================================
// DROPDOWN - helpers
// ==========================================
function sep() {
    const s = document.createElement('div');
    s.className = 'separador';
    return s;
}

function posicionarDropdown(dropdown, alvo) {
    const rect = alvo.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;
    const ddRect = dropdown.getBoundingClientRect();
    if (left + ddRect.width > window.innerWidth - 10) left = window.innerWidth - ddRect.width - 10;
    if (top + ddRect.height > window.innerHeight - 10) top = rect.top - ddRect.height - 6;
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
}

function fecharDropdown() {
    if (dropdownAberto) { dropdownAberto.remove(); dropdownAberto = null; }
}