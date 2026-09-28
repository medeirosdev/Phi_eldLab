# Phi_eldLab

**Φield Lab** — simulações de física interativas para o navegador: rigorosas nas equações, leves no carregamento e bonitas de ver.

## Simulações

| Módulo | Estado | O que mostra |
|---|---|---|
| **Gravitação** | ✅ | N corpos, leis de Kepler, pontos de Lagrange, figura-8, caos, encontro de discos |
| **Campo Elétrico** | ✅ | Coulomb, linhas de campo, equipotenciais, capacitor, espalhamento de Rutherford |
| **Tanque de Ondas** | ✅ | Interferência, Young, difração, lente, Snell, espelho parabólico, Doppler e cone de Mach |

### Gravitação em destaque

- **Física de verdade**: unidades astronômicas com G = 4π² (UA, M☉, anos), mostradores em SI.
- **Integradores selecionáveis**: Velocity Verlet (simplético), RK4 e Euler. Troque ao vivo e veja a energia derivar.
- **Passo adaptativo**: subpassos de até η·√(r³/GM) em encontros próximos.
- **Conservação medida na tela**: erro de energia e de momento angular em tempo real.
- **Leis de Kepler visíveis**: cônica osculadora, periélio/afélio, setores de áreas iguais e T²/a³.
- **Lançamento com trajetória prevista**: arraste para lançar; toque para órbita circular.
- **Cenários reais**: Sistema Solar (dados orbitais reais), Troianos de Júpiter, Kepler-16, figura-8 de Chenciner–Montgomery, problema pitagórico de Burrau, encontro de discos à la Toomre & Toomre.

Validação numérica (Verlet, η = 0,02):

| Teste | Resultado |
|---|---|
| Sistema Solar, 100 anos | \|ΔE\|/E ≈ 1 × 10⁻⁶ (Euler: 12 %) |
| Figura-8, 10 períodos | retorna a 4 × 10⁻⁴ UA da posição inicial |
| Terra em órbita circular | período medido 1,00000 ano |

### Campo Elétrico em destaque

- **Mapa de potencial e |E| na GPU**, com equipotenciais de ΔV uniforme e anti-serrilhadas.
- **Linhas de campo por RK4**, em número proporcional a |q| e com o sentido animado.
- **Partículas com dinâmica relativística** (elétron, próton, alfa) e trajetória prevista ao lançar.
- **Validações ao vivo**: carga inferida por |E|·r²/k, conservação de K + qV, desvio de Rutherford medido e comparado com θ = 2·arctan(d₀/2b).

### Tanque de Ondas em destaque

- **Equação de onda 2D na GPU** (WebGL2, diferenças finitas, 400 × 240 células, Δx = 1 mm) com bordas absorventes.
- **Ferramentas**: fontes, paredes, vidro (meio de índice n), sonda e régua marcada em comprimentos de onda.
- **Teoria sobreposta**: perfil de intensidade na tela comparado com Huygens (fenda dupla) e sinc² (fenda simples); foco da lente, lei de Snell e cone de Mach.

## Rodando

```bash
npm install
npm run dev      # servidor de desenvolvimento
npm run build    # build de produção em dist/
```

## Arquitetura

```
src/
├── core/            # núcleo agnóstico: loop de passo fixo, câmera, entrada, renderização
├── ui/              # shell, painel gerado por schema, gráficos, tela inicial
├── sims/<id>/       # cada simulação implementa a interface Simulation
└── registry.ts      # catálogo — cada módulo é carregado sob demanda
```

Para criar uma simulação nova: implemente `Simulation` (em [src/core/types.ts](src/core/types.ts)) numa pasta em `src/sims/` e registre em [src/registry.ts](src/registry.ts). Painel, mostradores, gráficos e controle de tempo são gerados automaticamente.

Sem dependências em produção: TypeScript + Vite, Canvas 2D e WebGL2.

## Publicação

Cada push na `main` publica o site no GitHub Pages pelo workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) (é preciso ativar **Settings → Pages → Source: GitHub Actions** uma vez).

Veja o [PLANO.md](PLANO.md) para a visão completa e o roteiro.

## Autor

**Guilherme de Medeiros Ellena** · UNICAMP, Matemática Aplicada e Computacional
[LinkedIn](https://www.linkedin.com/in/guilhermedemedeiros/)
