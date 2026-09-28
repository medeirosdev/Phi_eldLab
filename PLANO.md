# Φield Lab (Phi_eldLab) — Laboratório de Física Interativa

> Simulações de física no navegador: rigorosas nas equações, leves no carregamento e bonitas de ver.

---

## 1. Nome

**Φield Lab** — lê-se *"Field Lab"*: o Φ (phi) substitui o "F" de *field*, **campo** em inglês. Repositório: `Phi_eldLab`.

As três simulações iniciais tratam do mesmo conceito, o **campo**: o gravitacional, o elétrico e o de ondas. O nome escala bem para qualquer módulo futuro, já que magnetismo, fluidos e óptica também são campos. O Φ também é o símbolo usual de potencial e de fluxo na física.

---

## 2. Visão

Um laboratório que o professor abre no projetor e **a sala para para olhar**. Cada simulação precisa:

1. **Estar correta**: unidades SI, integradores numéricos adequados e grandezas conservadas visíveis na tela.
2. **Ser bonita**: tema escuro, traços luminosos, animações suaves e tipografia cuidada.
3. **Ser leve**: abrir em menos de 1 s, rodar a 60 fps num notebook comum e funcionar no celular.
4. **Ensinar**: toda interação revela uma lei física, com a equação e os valores ao vivo.

---

## 3. Módulos iniciais

### 3.1 Gravitação e órbitas

**O usuário faz:** arrasta para lançar corpos (o comprimento do arraste define a velocidade), cria sistemas estelares e quebra órbitas.

**A física:**
- Lei da gravitação universal com superposição: `F = G·m₁·m₂ / (r² + ε²)`, onde ε é um *softening* que evita a singularidade em colisões.
- Integrador **Velocity Verlet** (simplético), que conserva a energia a longo prazo. Com Euler, as órbitas espiralam para fora; com Verlet, elas fecham.
- Colisões opcionais: fusão inelástica com conservação de momento.
- Escala: força direta O(n²) até ~300 corpos; acima disso, **Barnes–Hut** O(n log n) (fase 3).

**O que o aluno vê:**
- Rastro de órbita com cor por velocidade.
- Vetores de velocidade e aceleração (liga/desliga).
- Gráfico ao vivo de energia cinética, potencial e total. A total fica plana, e essa é a prova de que a simulação está correta.
- Leis de Kepler: áreas varridas iguais em tempos iguais (setores coloridos) e medida de T² ∝ a³.
- Presets: Sol e Terra, sistema binário, figura-8 de três corpos (Chenciner–Montgomery), pontos de Lagrange.

### 3.2 Campo elétrico

**O usuário faz:** coloca cargas + e −, arrasta, altera magnitudes e solta partículas de teste.

**A física:**
- Lei de Coulomb com superposição: `E(r) = Σ k·qᵢ·(r − rᵢ) / |r − rᵢ|³`
- Potencial: `V(r) = Σ k·qᵢ / |r − rᵢ|`
- **Linhas de campo** traçadas com RK4 a partir de cada carga, com número de linhas proporcional a |q| (lei de Gauss visível).
- **Mapa de potencial** calculado por pixel num *fragment shader* (GPU), com curvas equipotenciais.
- Partículas de teste com massa e carga, integradas no campo.

**O que o aluno vê:**
- Linhas de campo animadas, com "fluxo" correndo ao longo delas.
- Mapa de potencial em cores (divergente: azul para −, vermelho para +) e equipotenciais em linhas finas.
- Sonda: passa o mouse e mostra |E|, direção e V naquele ponto.
- Presets: dipolo, capacitor de placas paralelas, quadrupolo, gaiola de Faraday (aproximada).

### 3.3 Tanque de ondas

**O usuário faz:** clica para criar fontes, desenha paredes e escolhe fenda simples, dupla ou lente.

**A física:**
- Equação de onda 2D: `∂²u/∂t² = c²(x,y)·∇²u − γ·∂u/∂t`
- Diferenças finitas na **GPU** (WebGL2, texturas *ping-pong*), com grade de 512×512 ou mais a 60 fps.
- Condição de estabilidade CFL: `c·Δt/Δx ≤ 1/√2`
- Bordas **absorventes** (camada de amortecimento), para que a onda não reflita na borda da tela.
- `c(x,y)` variável: meios com índice de refração diferente, o que dá refração e lentes.

**O que o aluno vê:**
- Superfície com iluminação (normais calculadas no shader), como água de verdade.
- Modo "intensidade média", que mostra as franjas de interferência de Young.
- Régua para medir λ e o espaçamento das franjas, comparando com `Δy = λL/d`.
- Presets: fenda dupla, difração, reflexão em parábola (foco), efeito Doppler (fonte móvel), refração em lente.

---

## 4. Arquitetura (pensada para escalar)

### Princípio
**O núcleo não conhece nenhuma simulação.** Cada simulação é um *plugin* que implementa uma interface fixa. Adicionar a simulação nº 20 não exige mexer no núcleo.

### Interface de uma simulação

```ts
interface Simulation {
  meta: {
    id: string;              // 'gravitacao'
    title: string;           // 'Gravitação e Órbitas'
    accent: string;          // cor de destaque do módulo
    tags: string[];          // ['mecânica', 'ensino médio']
  };
  params: ParamSchema;       // gera o painel de controles automaticamente
  presets: Preset[];         // cenários prontos
  readouts: ReadoutSchema;   // grandezas exibidas ao vivo (com unidade)

  init(ctx: SimContext): void;
  step(dt: number): void;    // física, passo fixo
  render(r: Renderer, alpha: number): void;  // alpha = interpolação entre passos
  onPointer?(e: PointerEvent2D): void;
  dispose(): void;
}
```

O painel de controles, os gráficos e os mostradores são **gerados a partir dos schemas**. A simulação só descreve o que precisa, e o núcleo desenha a interface.

### Loop principal (passo fixo + interpolação)

```
acumulador += tempoReal * velocidadeSimulação
enquanto acumulador >= dt:
    sim.step(dt)
    acumulador -= dt
sim.render(renderer, acumulador / dt)
```

Com isso a física é determinística e igual em monitores de 60 Hz ou 144 Hz, e a animação continua suave.

### Estrutura de pastas

```
Phi_eldLab/
├── index.html
├── src/
│   ├── core/
│   │   ├── loop.ts            # passo fixo, pausa, câmera lenta
│   │   ├── math/              # Vec2, integradores (Verlet, RK4)
│   │   ├── render/
│   │   │   ├── canvas2d.ts    # camada 2D (vetores, rastros, textos)
│   │   │   ├── gl.ts          # utilitários WebGL2 (shaders, FBO ping-pong)
│   │   │   └── bloom.ts       # pós-processamento de brilho
│   │   ├── camera.ts          # zoom/pan com mouse e toque
│   │   ├── input.ts           # pointer events unificados
│   │   └── units.ts           # formatação SI (1.23 × 10⁻⁶ C)
│   ├── ui/
│   │   ├── panel.ts           # painel gerado a partir do schema
│   │   ├── chart.ts           # gráfico em tempo real (canvas, leve)
│   │   ├── readout.ts         # mostradores numéricos
│   │   └── theme.css          # tokens de design
│   ├── sims/
│   │   ├── gravitacao/
│   │   ├── campo-eletrico/
│   │   └── ondas/
│   │       ├── index.ts       # implementa Simulation
│   │       ├── shaders/       # .glsl
│   │       └── presets.ts
│   ├── registry.ts            # lista de sims (import dinâmico)
│   └── main.ts                # roteador (#/gravitacao) e shell
└── public/
```

### Decisões técnicas

| Decisão | Escolha | Por quê |
|---|---|---|
| Linguagem | **TypeScript** | Vira JS puro no navegador. Com dezenas de módulos, os tipos evitam bugs e documentam a interface de plugin. |
| Build | **Vite** | Rápido, zero configuração, *code splitting* automático. |
| Framework UI | **Nenhum** | O painel é simples e gerado por schema. Sem React, economiza ~45 KB e fica mais rápido. |
| Renderização | **Canvas 2D + WebGL2** | 2D para vetores e textos; GPU para campos e ondas (milhões de pixels por frame). |
| Motor de física | **Próprio** | Matter.js e Box2D são para jogos e sacrificam precisão. Aqui as equações são o produto. |
| Equações | **KaTeX**, carregado sob demanda | Só baixa quando o usuário abre o painel "Equações". |
| Carregamento | **Import dinâmico por simulação** | Abrir "Ondas" não baixa o código de "Gravitação". |

### Orçamento de desempenho

- JS inicial (shell + núcleo): **< 40 KB gzip**
- Cada simulação: **< 30 KB gzip**
- 60 fps em notebook de entrada com GPU integrada
- Funciona em celular (toque, pinça para zoom, layout vertical)

---

## 5. Design

### Direção visual
**"Instrumento científico à noite"**: fundo quase preto com leve tom azulado, fenômenos físicos que **emitem luz** e uma interface que some quando não é necessária.

### Tokens

```css
:root {
  /* superfície */
  --bg:          #07090f;
  --bg-elev:     rgba(18, 22, 34, 0.72);   /* painéis com vidro fosco */
  --line:        rgba(255, 255, 255, 0.08);
  --text:        #e8ecf4;
  --text-dim:    #8a93a8;

  /* destaque por módulo */
  --acc-grav:    #ffb547;   /* âmbar: estrelas, órbitas */
  --acc-elet:    #5ab0ff;   /* azul elétrico */
  --acc-ondas:   #3ee6c4;   /* ciano-água */

  /* semântico */
  --pos:         #ff5a6e;   /* carga +, energia cinética */
  --neg:         #4f8bff;   /* carga −, energia potencial */
  --total:       #f4f4f4;   /* energia total */

  --font-ui:     'Inter', system-ui, sans-serif;
  --font-num:    'JetBrains Mono', ui-monospace, monospace;
  --radius:      14px;
}
```

### Ingredientes da beleza
- **Bloom** (brilho) em pós-processamento WebGL: corpos, cargas e cristas de onda "acendem".
- **Rastros com decaimento exponencial**, sem cortes secos.
- **Números em fonte mono tabular**, para que não tremam enquanto mudam.
- **Micro-animações** de 150–250 ms com *easing* em painéis e botões.
- **Vidro fosco** (`backdrop-filter: blur`) nos painéis sobre a simulação.
- **Tela inicial** com as três simulações rodando ao vivo em miniatura como cards. É a primeira impressão.
- Nitidez em telas retina (`devicePixelRatio`) e resolução adaptativa se o fps cair.

### Layout

```
┌─────────────────────────────────────────────────────┐
│ Φield Lab  Gravitação · Elétrico · Ondas      ⚙  ?  │
├─────────────────────────────────────────┬───────────┤
│                                         │ Controles │
│                                         │  ───────  │
│           SIMULAÇÃO (tela cheia)        │ Presets   │
│                                         │  ───────  │
│                                         │ Gráfico   │
│  ⏸  ▶  ×0.25 ×1 ×4        ⟲ reset       │ Energia   │
└─────────────────────────────────────────┴───────────┘
```

No celular, o painel lateral vira uma gaveta inferior deslizante.

---

## 6. Recursos educacionais (transversais a todas as simulações)

- **Painel "Equações"**: mostra as leis em uso, com os valores atuais substituídos.
- **Câmera lenta e passo a passo**: avança um Δt por clique.
- **Compartilhar cenário**: o estado inteiro vai na URL (`#/ondas?preset=fenda-dupla&lambda=0.03`), e o professor manda o link para a turma.
- **Modo apresentação**: esconde a interface, aumenta as fontes e usa alto contraste para projetor.
- **Desafios** (fase 3): "coloque um satélite em órbita geoestacionária", "faça a interferência sumir no centro".

---

## 7. Roteiro

### Fase 0: Fundação
- [x] Projeto Vite + TypeScript
- [x] Loop com passo fixo, pausa e velocidade
- [x] Câmera (zoom/pan, toque)
- [x] Tokens de design + shell da interface
- [x] Painel gerado por schema + gráfico em tempo real
- [x] Registro de simulações com import dinâmico e roteamento

### Fase 1: Gravitação (primeira simulação completa)
- [x] Velocity Verlet + softening
- [x] Lançar corpos arrastando
- [x] Rastros, vetores, bloom
- [x] Gráfico de energia
- [x] Presets (incluindo a figura-8)

### Fase 2: Ondas e Campo Elétrico
- [x] Ondas: solver na GPU, bordas absorventes, paredes desenháveis, iluminação
- [x] Elétrico: linhas de campo RK4, mapa de potencial no shader, partículas de teste

### Fase 3: Polimento e escala
- [x] Tela inicial com miniaturas ao vivo
- [ ] Compartilhamento por URL, modo apresentação
- [ ] Barnes–Hut para milhares de corpos
- [ ] PWA (funciona offline, instalável)
- [ ] Internacionalização (pt-BR / en)

### Próximos módulos (a arquitetura já comporta)
Pêndulo duplo e caos · Campo magnético e força de Lorentz · Óptica geométrica · Fluidos (SPH) · Termodinâmica (gás de partículas e distribuição de Maxwell–Boltzmann) · Relatividade restrita

---

## 8. Critério de "impressionar"

Uma simulação só está pronta quando:
1. Um leigo acha bonita nos primeiros 3 segundos.
2. Um físico confere uma grandeza conservada e ela está certa.
3. Roda liso no celular de um aluno.
