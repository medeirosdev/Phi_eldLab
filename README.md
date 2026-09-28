# Phi_eldLab

**Φield Lab** — simulações de física interativas para o navegador: rigorosas nas equações, leves no carregamento e bonitas de ver.

## Simulações

| Módulo | Estado | O que mostra |
|---|---|---|
| **Gravitação** | ✅ pronto | N corpos, leis de Kepler, pontos de Lagrange, figura-8, caos, encontro de discos |
| **Campo Elétrico** | em breve | Coulomb, linhas de campo, potencial |
| **Tanque de Ondas** | em breve | Interferência, difração, refração (GPU) |

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

Sem dependências em produção: TypeScript + Vite, Canvas 2D (e WebGL nos módulos que precisarem).

Veja o [PLANO.md](PLANO.md) para a visão completa e o roteiro.
