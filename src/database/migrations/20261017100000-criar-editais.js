'use strict';

/**
 * EDITAL de selecao de monitores.
 *
 * O edital e o documento institucional que abre um processo seletivo: tem um
 * periodo de inscricoes, um link para o PDF oficial e o periodo academico a que
 * se refere. Ele NAO guarda vagas, etapas nem resultado — isso viveria em
 * entidades proprias, e nada no escopo atual precisa delas.
 *
 * ---------------------------------------------------------------------------
 * `ativo` — EXCLUSAO LOGICA, por decisao registrada
 *
 * A coluna existe para atender "excluir editais" sem apagar linha. Um edital
 * com inscricoes recebidas e historico: apaga-lo deixaria candidatos apontando
 * para um processo que o sistema afirma nunca ter existido, e a FK em
 * `inscricoes_edital` e RESTRICT justamente para impedir isso.
 *
 * E o mesmo mecanismo que `cursos.ativo` e `disciplinas.ativa` ja usam, pelo
 * mesmo motivo (RN10). Vale dizer o custo as claras: toda consulta publica
 * precisa filtrar por `ativo`, e esquecer o filtro reabre um edital excluido.
 * Por isso o filtro esta no service, em um unico lugar.
 *
 * ---------------------------------------------------------------------------
 * AS DATAS SAO `date`, NAO `timestamptz`
 *
 * "Inscricoes de 10/11 a 25/11" e uma afirmacao sobre DIAS do calendario local,
 * nao sobre instantes. Guardar instante obrigaria a escolher uma hora de corte
 * arbitraria (00:00? 23:59:59?) e faria o mesmo edital abrir em dias diferentes
 * dependendo do fuso de quem le. O dia "hoje" e resolvido pelo proprio
 * PostgreSQL com AT TIME ZONE sobre o fuso da instituicao, como o resto do
 * projeto ja faz com disponibilidades.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('editais', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      inicio_inscricoes: { type: Sequelize.DATEONLY, allowNull: false },
      fim_inscricoes: { type: Sequelize.DATEONLY, allowNull: false },

      /** URL do PDF oficial, hospedado pela instituicao. TEXT: URL nao tem teto util. */
      link: { type: Sequelize.TEXT, allowNull: false },

      ano: { type: Sequelize.SMALLINT, allowNull: false },
      semestre: { type: Sequelize.SMALLINT, allowNull: false },

      /** Exclusao logica. Ver o cabecalho. */
      ativo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    /**
     * Periodo invalido e impossivel no BANCO, nao apenas no DTO.
     *
     * Sem esta CHECK, um UPDATE que mexesse em apenas uma das duas datas
     * poderia deixar `fim < inicio` — e um edital nesse estado nao e so
     * esquisito: ele nunca aceita inscricao nenhuma, e o motivo nao aparece em
     * lugar algum. `ano` e `semestre` seguem o mesmo criterio usado em
     * `monitorias`.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE editais
        ADD CONSTRAINT ck_edital_periodo CHECK (fim_inscricoes >= inicio_inscricoes),
        ADD CONSTRAINT ck_edital_semestre CHECK (semestre IN (1, 2)),
        ADD CONSTRAINT ck_edital_ano CHECK (ano BETWEEN 2000 AND 2100),
        ADD CONSTRAINT ck_edital_link CHECK (btrim(link) <> '');
    `);

    /**
     * Indice para a consulta publica de editais abertos, que e a unica chamada
     * sem autenticacao e portanto a que mais recebe trafego anonimo.
     */
    await queryInterface.addIndex('editais', ['ativo', 'inicio_inscricoes', 'fim_inscricoes'], {
      name: 'ix_edital_abertos',
    });

    await queryInterface.addIndex('editais', ['ano', 'semestre'], { name: 'ix_edital_periodo' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('editais');
  },
};
