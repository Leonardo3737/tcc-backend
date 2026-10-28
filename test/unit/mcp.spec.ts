import 'reflect-metadata';

import { MCP_ROLES_METADATA_KEY, MCP_TOOL_METADATA_KEY, ToolMetadata } from '@rekog/mcp-nest';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { AnalyticsMcpController } from '../../src/modules/analytics/analytics.mcp-controller';
import { AtendimentosMonitoriaMcpController } from '../../src/modules/atendimentos/atendimentos-monitoria.mcp-controller';
import { AtendimentosMcpController } from '../../src/modules/atendimentos/atendimentos.mcp-controller';
import { AvaliacoesMcpController } from '../../src/modules/avaliacoes/avaliacoes.mcp-controller';
import { ConfiguracaoMcpController } from '../../src/modules/configuracao/configuracao.mcp-controller';
import { CursosMcpController } from '../../src/modules/cursos/cursos.mcp-controller';
import { DisciplinasMcpController } from '../../src/modules/disciplinas/disciplinas.mcp-controller';
import { DisponibilidadesMcpController } from '../../src/modules/disponibilidades/disponibilidades.mcp-controller';
import { EditaisMcpController } from '../../src/modules/editais/editais.mcp-controller';
import { InscricoesMcpController } from '../../src/modules/editais/inscricoes.mcp-controller';
import { GamificacaoMcpController } from '../../src/modules/gamificacao/gamificacao.mcp-controller';
import { MateriaisMcpController } from '../../src/modules/materiais/materiais.mcp-controller';
import { MonitoriasMcpController } from '../../src/modules/monitorias/monitorias.mcp-controller';
import { ParticipantesMcpController } from '../../src/modules/monitorias/participantes.mcp-controller';
import { RelatoriosMcpController } from '../../src/modules/relatorios/relatorios.mcp-controller';
import { AlunosMcpController } from '../../src/modules/usuarios/alunos.mcp-controller';
import { ProfessoresMcpController } from '../../src/modules/usuarios/professores.mcp-controller';
import { UsuariosMcpController } from '../../src/modules/usuarios/usuarios.mcp-controller';

/**
 * Contrato das ferramentas MCP.
 *
 * O MCP e uma SEGUNDA porta para os mesmos services. Guard de rota nao protege
 * ferramenta: `@Perfis` nao e lido no caminho MCP e `ParticipacaoGuard` depende
 * de um `:monitoriaId` que nao existe ali. Entao a unica garantia de que uma
 * ferramenta nova nao nasca aberta e esta tabela — se alguem acrescentar um
 * `@Tool` sem declarar aqui qual perfil ele exige, o teste quebra.
 *
 * A tabela e escrita A PARTIR dos controllers REST equivalentes, nao a partir
 * dos MCP: copiar do codigo testado faria o teste concordar com o bug.
 */

const CONTROLLERS = [
  AnalyticsMcpController,
  AtendimentosMonitoriaMcpController,
  AtendimentosMcpController,
  AvaliacoesMcpController,
  ConfiguracaoMcpController,
  CursosMcpController,
  DisciplinasMcpController,
  DisponibilidadesMcpController,
  EditaisMcpController,
  InscricoesMcpController,
  GamificacaoMcpController,
  MateriaisMcpController,
  MonitoriasMcpController,
  ParticipantesMcpController,
  RelatoriosMcpController,
  AlunosMcpController,
  ProfessoresMcpController,
  UsuariosMcpController,
];

const P = PerfilUsuario.PROFESSOR;
const A = PerfilUsuario.ALUNO;

/**
 * [perfil exigido, modifica dados?]
 *
 * `null` em perfil significa "qualquer usuario autenticado" — nunca "qualquer
 * um": a sessao MCP so existe com token valido.
 *
 * `escreve` controla `readOnlyHint`, que e o que faz o cliente pedir (ou nao)
 * confirmacao ao usuario. Exportar planilha e gerar relatorio sao LEITURA:
 * produzem um arquivo a partir do que ja esta gravado, sem alterar nada.
 */
const ESPERADO: Record<string, [PerfilUsuario | null, boolean]> = {
  // analytics
  indicadores_da_plataforma: [P, false],
  indicadores_da_monitoria: [null, false],
  atividade_dos_monitores: [P, false],

  // atendimentos (escopo monitoria)
  agendar_atendimento: [null, true],
  agendar_atendimentos_em_lote: [null, true],
  listar_horarios_livres: [null, false],
  listar_atendimentos_da_monitoria: [null, false],

  // atendimentos (escopo atendimento)
  listar_meus_atendimentos: [null, false],
  detalhar_atendimento: [null, false],
  historico_do_atendimento: [null, false],
  inscrever_me_em_atendimento: [null, true],
  cancelar_minha_inscricao_em_atendimento: [null, true],
  reagendar_atendimento: [null, true],
  atualizar_atendimento: [null, true],
  realizar_atendimento: [null, true],
  cancelar_atendimento: [null, true],

  // avaliacoes
  avaliar_atendimento: [null, true],
  listar_avaliacoes_do_atendimento: [null, false],
  listar_avaliacoes_do_monitor: [null, false],

  // configuracao
  obter_configuracao: [null, false],

  // catalogos
  criar_curso: [P, true],
  listar_cursos: [null, false],
  detalhar_curso: [null, false],
  atualizar_curso: [P, true],
  criar_disciplina: [P, true],
  listar_disciplinas: [null, false],
  detalhar_disciplina: [null, false],
  atualizar_disciplina: [P, true],

  // disponibilidades
  criar_disponibilidade: [null, true],
  listar_disponibilidades: [null, false],
  desativar_disponibilidade: [null, true],

  // editais
  criar_edital: [P, true],
  listar_editais: [P, false],
  detalhar_edital: [P, false],
  atualizar_edital: [P, true],
  excluir_edital: [P, true],

  // inscricoes em edital
  listar_inscricoes: [P, false],
  resumo_de_inscricoes_por_disciplina: [P, false],
  detalhar_inscricao: [P, false],
  exportar_inscricoes: [P, false],
  obter_boletim_da_inscricao: [P, false],
  aprovar_inscricao: [P, true],

  // gamificacao
  listar_regras_de_pontuacao: [null, false],
  listar_ranking: [null, false],
  obter_meus_pontos: [null, false],

  // materiais
  publicar_material: [null, true],
  listar_materiais: [null, false],
  detalhar_material: [null, false],
  atualizar_material: [null, true],
  remover_material: [null, true],

  // monitorias
  listar_monitorias: [null, false],
  criar_monitoria: [P, true],
  listar_minhas_monitorias: [null, false],
  detalhar_monitoria: [null, false],
  atualizar_monitoria: [P, true],
  ativar_monitoria: [P, true],
  encerrar_monitoria: [P, true],
  cancelar_monitoria: [P, true],

  // participantes
  habilitar_monitor: [P, true],
  inscrever_monitorado: [P, true],
  inscrever_me_como_monitorado: [A, true],
  listar_participantes: [null, false],
  promover_participante_a_monitor: [P, true],
  encerrar_participacao: [null, true],

  // relatorio
  gerar_relatorio_de_monitoria: [null, false],

  // usuarios
  criar_aluno: [P, true],
  listar_alunos: [P, false],
  atualizar_meu_cadastro_de_aluno: [A, true],
  buscar_aluno: [null, false],
  criar_professor: [P, true],
  listar_professores: [null, false],
  atualizar_meu_cadastro_de_professor: [P, true],
  buscar_professor: [null, false],
  obter_meu_usuario: [null, false],
  atualizar_meu_usuario: [null, true],
};

interface Ferramenta {
  classe: string;
  metodo: string;
  tool: ToolMetadata;
  perfis: string[] | undefined;
}

function coletar(): Ferramenta[] {
  return CONTROLLERS.flatMap((classe) => {
    const proto = classe.prototype as unknown as Record<string, unknown>;

    return Object.getOwnPropertyNames(proto)
      .filter((metodo) => metodo !== 'constructor')
      .map((metodo) => ({
        classe: classe.name,
        metodo,
        tool: Reflect.getMetadata(MCP_TOOL_METADATA_KEY, proto[metodo] as object) as ToolMetadata,
        perfis: Reflect.getMetadata(MCP_ROLES_METADATA_KEY, proto[metodo] as object) as
          string[] | undefined,
      }))
      .filter((f) => f.tool !== undefined);
  });
}

const FERRAMENTAS = coletar();

describe('ferramentas MCP', () => {
  it('expoe exatamente as ferramentas declaradas na tabela', () => {
    const encontradas = FERRAMENTAS.map((f) => f.tool.name).sort();
    expect(encontradas).toEqual(Object.keys(ESPERADO).sort());
  });

  it('nao repete nome de ferramenta entre controllers', () => {
    const nomes = FERRAMENTAS.map((f) => f.tool.name);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  describe.each(FERRAMENTAS.map((f): [string, Ferramenta] => [f.tool.name, f]))(
    '%s',
    (nome, ferramenta) => {
      const [perfilEsperado, escreve] = ESPERADO[nome];

      it('exige o mesmo perfil da rota REST equivalente', () => {
        expect(ferramenta.perfis ?? null).toEqual(perfilEsperado ? [perfilEsperado] : null);
      });

      it('declara readOnlyHint coerente com o que faz', () => {
        expect(ferramenta.tool.annotations?.readOnlyHint).toBe(!escreve);
      });

      it('tem descricao util', () => {
        expect((ferramenta.tool.description ?? '').length).toBeGreaterThan(30);
      });

      /**
       * `additionalProperties: false` e o que faz a ferramenta RECUSAR um campo
       * que o cliente inventou, em vez de ignorar em silencio. E o mesmo papel
       * do `forbidNonWhitelisted` no REST — sem ele, mandar `professorId` em
       * `criar_monitoria` deixaria de ser erro.
       */
      it('publica um schema de objeto fechado', () => {
        const schema = ferramenta.tool.parameters as Record<string, unknown>;

        expect(schema.type).toBe('object');
        expect(schema.additionalProperties).toBe(false);
      });

      /**
       * `$ref` aponta para um `definitions` que nao acompanha o schema da
       * ferramenta: o cliente receberia uma referencia que nao resolve e nao
       * saberia montar o argumento.
       */
      it('nao deixa referencia pendente no schema', () => {
        expect(JSON.stringify(ferramenta.tool.parameters)).not.toContain('$ref');
      });
    },
  );
});

describe('fronteira do modulo de editais', () => {
  /**
   * A inscricao publica e a UNICA escrita anonima da API e existe para quem
   * ainda nao tem conta. Uma sessao MCP e sempre autenticada, entao expo-la
   * aqui significaria um professor logado inscrevendo terceiros — exatamente o
   * que o fluxo publico nao permite.
   */
  it('nao expoe a inscricao publica em edital como ferramenta', () => {
    const nomes = FERRAMENTAS.map((f) => f.tool.name);

    expect(nomes).not.toContain('criar_inscricao');
    expect(nomes).not.toContain('inscrever_candidato');
    const deCandidatura = FERRAMENTAS.filter((f) => f.classe === 'InscricoesMcpController').map(
      (f) => f.tool.name,
    );

    expect(deCandidatura).toEqual([
      'listar_inscricoes',
      'resumo_de_inscricoes_por_disciplina',
      'detalhar_inscricao',
      'exportar_inscricoes',
      'obter_boletim_da_inscricao',
      'aprovar_inscricao',
    ]);
  });

  it('toda ferramenta de candidatura exige PROFESSOR', () => {
    const deCandidatura = FERRAMENTAS.filter((f) => f.classe === 'InscricoesMcpController');

    expect(deCandidatura.length).toBeGreaterThan(0);
    for (const f of deCandidatura) {
      expect(f.perfis).toEqual([PerfilUsuario.PROFESSOR]);
    }
  });
});

describe('troca de senha', () => {
  /**
   * Argumento de ferramenta passa pelo cliente e pelo modelo antes de chegar ao
   * servidor. A senha nao tem o que fazer nesse caminho.
   */
  it('nao expoe nenhuma ferramenta que receba senha', () => {
    for (const f of FERRAMENTAS) {
      const schema = JSON.stringify(f.tool.parameters).toLowerCase();

      expect(schema).not.toContain('senha');
      expect(schema).not.toContain('password');
    }
  });
});
