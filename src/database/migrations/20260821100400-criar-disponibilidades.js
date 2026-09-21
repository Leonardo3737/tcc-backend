'use strict';

/**
 * DISPONIBILIDADE: recorrencia semanal declarada pelo monitor (D-04).
 *
 * Uma linha significa "toda terca, das 14h as 16h, estou disponivel nesta
 * monitoria". Nao sao encontros concretos — encontros sao ATENDIMENTOS. Duas ou
 * tres linhas cobrem o semestre inteiro, e o agendamento e validado contra elas.
 *
 * As colunas `monitoria_id` e `papel_esperado` existem para viabilizar a FK
 * composta: elas fazem o BANCO garantir que so um participante ATIVO com papel
 * MONITOR daquela monitoria pode declarar disponibilidade. `papel_esperado` e
 * uma coluna tecnica de valor fixo — nunca deve ser exposta pela API.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('disponibilidades', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      participante_id: { type: Sequelize.UUID, allowNull: false },
      monitoria_id: { type: Sequelize.UUID, allowNull: false },
      papel_esperado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'MONITOR' },
      dia_semana: { type: Sequelize.SMALLINT, allowNull: false },
      hora_inicio: { type: Sequelize.TIME, allowNull: false },
      hora_fim: { type: Sequelize.TIME, allowNull: false },
      ativa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
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

    await queryInterface.sequelize.query(`
      ALTER TABLE disponibilidades
        ADD CONSTRAINT ck_disponibilidade_papel CHECK (papel_esperado = 'MONITOR'),
        ADD CONSTRAINT ck_disponibilidade_dia CHECK (dia_semana BETWEEN 0 AND 6),
        ADD CONSTRAINT ck_disponibilidade_intervalo CHECK (hora_fim > hora_inicio);
    `);

    // Somente um MONITOR daquela monitoria pode ter disponibilidade nela.
    await queryInterface.sequelize.query(`
      ALTER TABLE disponibilidades
        ADD CONSTRAINT fk_disponibilidade_participante
          FOREIGN KEY (participante_id, monitoria_id, papel_esperado)
          REFERENCES monitoria_participantes (id, monitoria_id, papel)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    /**
     * Faixas de disponibilidade do mesmo monitor, no mesmo dia da semana, nao
     * podem se sobrepor.
     *
     * PostgreSQL nao tem um range nativo de `time`, entao a faixa e convertida
     * para minutos desde a meia-noite e comparada como int4range. `date_part`
     * sobre `time` e imutavel, o que permite usa-la dentro do indice.
     *
     * O indice e parcial (`WHERE ativa`) para que faixas desativadas — que ficam
     * no banco por causa da RN10 — nao bloqueiem o cadastro de faixas novas.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE disponibilidades
        ADD CONSTRAINT ex_disponibilidade_sem_sobreposicao
          EXCLUDE USING gist (
            participante_id WITH =,
            dia_semana WITH =,
            int4range(
              (date_part('hour', hora_inicio) * 60 + date_part('minute', hora_inicio))::int,
              (date_part('hour', hora_fim)   * 60 + date_part('minute', hora_fim))::int
            ) WITH &&
          ) WHERE (ativa);
    `);

    await queryInterface.addIndex('disponibilidades', ['monitoria_id', 'ativa'], {
      name: 'ix_disponibilidades_monitoria',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('disponibilidades');
  },
};
