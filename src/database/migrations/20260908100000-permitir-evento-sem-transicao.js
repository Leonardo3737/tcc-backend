'use strict';

/**
 * Abre a trilha de historico para eventos que NAO mudam o status.
 *
 * Motivacao: o reagendamento (POST /atendimentos/:id/reagendar) altera inicio e
 * fim mantendo o atendimento AGENDADO. Sem esta mudanca ele nao teria onde ser
 * registrado — o CHECK anterior exigia `status_anterior <> status_novo` — e o
 * horario original seria simplesmente sobrescrito, que e exatamente o tipo de
 * perda que a RN10 proibe.
 *
 * A tabela deixa de ser "transicoes de status" e passa a ser "trilha de eventos
 * do atendimento". Para que uma linha de mesmo status nao vire ruido sem
 * explicacao, o CHECK novo exige `motivo` justamente nesse caso: se o status nao
 * mudou, a linha PRECISA dizer o que mudou.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE atendimento_status_historico
        DROP CONSTRAINT ck_historico_transicao,
        ADD CONSTRAINT ck_historico_evento
          CHECK (status_anterior IS DISTINCT FROM status_novo OR motivo IS NOT NULL);
    `);
  },

  async down(queryInterface) {
    /**
     * Volta ao CHECK original. Linhas de reagendamento (mesmo status) passariam
     * a violar a regra, entao sao removidas antes — sao o unico caso possivel de
     * status_anterior = status_novo, criado exclusivamente por esta feature.
     */
    await queryInterface.sequelize.query(`
      DELETE FROM atendimento_status_historico
       WHERE status_anterior IS NOT DISTINCT FROM status_novo;

      ALTER TABLE atendimento_status_historico
        DROP CONSTRAINT ck_historico_evento,
        ADD CONSTRAINT ck_historico_transicao
          CHECK (status_anterior IS DISTINCT FROM status_novo);
    `);
  },
};
