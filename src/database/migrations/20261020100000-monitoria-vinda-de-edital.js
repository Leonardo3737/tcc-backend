'use strict';

/**
 * `monitorias.edital_id` — a monitoria passa a poder dizer DE ONDE veio.
 *
 * Fecha o ciclo da selecao: o professor aprova uma candidatura e o sistema cria
 * a monitoria da disciplina com o candidato habilitado como MONITOR. Sem esta
 * coluna, a monitoria criada assim seria indistinguivel de uma criada a mao, e a
 * pergunta que a banca faz na tela — "desta disciplina ja cadastrei a
 * monitoria?" — nao teria resposta no banco.
 *
 * ---------------------------------------------------------------------------
 * NULAVEL, E ISSO E PARTE DO REQUISITO
 *
 * Monitoria sem edital continua valendo: o caminho `POST /monitorias` nao muda
 * em nada e grava `edital_id` nulo. A coluna e uma PROCEDENCIA opcional, nao um
 * vinculo obrigatorio — e e por isso que ela nao entra em nenhuma constraint
 * que mudaria o comportamento das monitorias ja existentes.
 *
 * O backfill tambem e trivial por isso: as monitorias atuais ficam com nulo,
 * que e exatamente o que elas sao — criadas fora de processo seletivo.
 *
 * ---------------------------------------------------------------------------
 * `ON DELETE RESTRICT`
 *
 * Mesmo criterio do resto do projeto (RN10): um edital referenciado por
 * monitoria nao se apaga. Ele ja nao se apagava por causa das inscricoes, e a
 * exclusao de edital e logica (`editais.ativo`); esta FK apenas soma mais um
 * motivo pelo qual apagar a linha seria destruir historico.
 *
 * ---------------------------------------------------------------------------
 * O QUE NAO FOI ADICIONADO, DE PROPOSITO
 *
 * Nao existe `UNIQUE (edital_id, disciplina_id)`. Ela faria valer "cada
 * disciplina tem UMA monitoria por edital", que e a leitura natural do processo
 * — mas o que o schema ja garante e outra coisa: `uq_monitoria_oferta` e
 * `UNIQUE (disciplina_id, professor_id, ano, semestre)`. Dois candidatos da
 * mesma disciplina que indicaram professores DIFERENTES produziriam duas
 * monitorias legitimas por essa regra, e a UNIQUE nova as recusaria no momento
 * da aprovacao — no fim do processo seletivo, que e o pior momento possivel para
 * descobrir uma regra.
 *
 * Como o servico de aprovacao REUSA a monitoria quando ela ja existe para a
 * mesma oferta, o caso comum (varios monitores na mesma disciplina) ja resulta
 * em uma monitoria so. A constraint fica de fora enquanto a regra nao for
 * decidida explicitamente.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('monitorias', 'edital_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'editais', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    /**
     * Indice PARCIAL: so as monitorias que vieram de edital entram.
     *
     * E a consulta que o resumo por disciplina faz — "existe monitoria deste
     * edital para esta disciplina?" —, e a maioria das linhas tem `edital_id`
     * nulo e nunca participa dela. Indice parcial mantem fora o que nao se
     * consulta, em vez de carregar nulos a toa.
     */
    await queryInterface.sequelize.query(`
      CREATE INDEX ix_monitoria_edital
        ON monitorias (edital_id, disciplina_id)
        WHERE edital_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS ix_monitoria_edital;');
    await queryInterface.removeColumn('monitorias', 'edital_id');
  },
};
