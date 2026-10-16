'use strict';

/**
 * CURSO, e a regra de que aluno so participa de monitoria do proprio curso.
 *
 * A regra NAO fica apenas no service. Ela e garantida por uma cadeia de FKs
 * COMPOSTAS, o mesmo recurso que ja sustenta RN01, RN02 e RN04:
 *
 *   monitoria_participantes (monitoria_id, curso_id) -> monitorias (id, curso_id)
 *   monitoria_participantes (aluno_id,     curso_id) -> alunos     (usuario_id, curso_id)
 *   monitorias              (disciplina_id, curso_id) -> disciplinas (id, curso_id)
 *
 * Lidas juntas: o curso do vinculo tem de ser ao mesmo tempo o curso da
 * monitoria e o curso do aluno; e o curso da monitoria tem de ser o da sua
 * disciplina. Logo, aluno e disciplina compartilham curso — que e a regra, agora
 * impossivel de violar por INSERT direto, nao so pela API.
 *
 * `curso_id` aparece denormalizado em `monitorias` e em
 * `monitoria_participantes` exatamente para isso: uma FK composta so pode
 * referenciar colunas da propria linha. Nao e dado solto — o `ON UPDATE CASCADE`
 * propaga a troca a partir da origem, como ja acontece com inicio/fim das
 * inscricoes.
 *
 * ---------------------------------------------------------------------------
 * CONSEQUENCIA QUE PRECISA ESTAR AS CLARAS
 *
 * Com a FK composta ate `alunos`, trocar um aluno de curso passa a ser
 * bloqueado enquanto existir QUALQUER participacao dele — inclusive ENCERRADA,
 * porque a RN10 preserva historico para sempre. Mudar o curso exigiria
 * reescrever vinculos passados, afirmando que uma monitoria cursada ocorreu em
 * um curso em que ela nao ocorreu.
 *
 * ---------------------------------------------------------------------------
 * BACKFILL
 *
 * A base existente nao tem curso. A migration cria um curso provisorio e vincula
 * tudo a ele, mantendo as constraints satisfeitas desde o primeiro instante. A
 * coluna de texto livre `alunos.curso` e REMOVIDA: manter as duas faria a
 * informacao divergir, e o valor dela nunca foi confiavel (eram textos digitados
 * a mao, como "si" e "Engenharia").
 */
const CURSO_PROVISORIO = 'Curso nao informado';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cursos', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      /** CITEXT como em disciplinas: "eng001" e "ENG001" sao o mesmo codigo. */
      codigo: { type: 'CITEXT', allowNull: false, unique: true },
      nome: { type: Sequelize.STRING(150), allowNull: false },
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

    const [[curso]] = await queryInterface.sequelize.query(`
      INSERT INTO cursos (nome, codigo) VALUES ('${CURSO_PROVISORIO}', 'CNI001')
      RETURNING id;
    `);

    const provisorio = curso.id;

    /**
     * `disciplinas.curso_id`.
     *
     * A UNIQUE (id, curso_id) parece redundante — `id` ja e PK —, mas e
     * obrigatoria: o PostgreSQL exige que o alvo de uma FK composta seja coberto
     * por uma restricao unica sobre exatamente aquelas colunas.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE disciplinas ADD COLUMN curso_id uuid;
      UPDATE disciplinas SET curso_id = '${provisorio}';
      ALTER TABLE disciplinas
        ALTER COLUMN curso_id SET NOT NULL,
        ADD CONSTRAINT fk_disciplina_curso
          FOREIGN KEY (curso_id) REFERENCES cursos (id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_disciplina_curso UNIQUE (id, curso_id);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE alunos ADD COLUMN curso_id uuid;
      UPDATE alunos SET curso_id = '${provisorio}';
      ALTER TABLE alunos
        ALTER COLUMN curso_id SET NOT NULL,
        ADD CONSTRAINT fk_aluno_curso
          FOREIGN KEY (curso_id) REFERENCES cursos (id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_aluno_curso UNIQUE (usuario_id, curso_id),
        DROP COLUMN curso;
    `);

    /**
     * `monitorias.curso_id`, amarrado a disciplina.
     *
     * O valor vem da disciplina e nao pode divergir dela: a FK composta abaixo
     * recusa qualquer combinacao que nao exista em `disciplinas`. Se uma
     * disciplina mudar de curso, o CASCADE propaga para suas monitorias.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitorias ADD COLUMN curso_id uuid;
      UPDATE monitorias m SET curso_id = d.curso_id
        FROM disciplinas d WHERE d.id = m.disciplina_id;
      ALTER TABLE monitorias
        ALTER COLUMN curso_id SET NOT NULL,
        ADD CONSTRAINT fk_monitoria_disciplina_curso
          FOREIGN KEY (disciplina_id, curso_id) REFERENCES disciplinas (id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT uq_monitoria_curso UNIQUE (id, curso_id);
    `);

    /**
     * `monitoria_participantes.curso_id` — onde a regra se fecha.
     *
     * As duas FKs juntas exigem que o mesmo `curso_id` exista como curso da
     * monitoria E como curso do aluno. Nao ha valor que satisfaca as duas se os
     * cursos diferirem, entao o vinculo simplesmente nao pode ser criado.
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes ADD COLUMN curso_id uuid;
      UPDATE monitoria_participantes mp SET curso_id = m.curso_id
        FROM monitorias m WHERE m.id = mp.monitoria_id;
      ALTER TABLE monitoria_participantes
        ALTER COLUMN curso_id SET NOT NULL,
        ADD CONSTRAINT fk_participante_monitoria_curso
          FOREIGN KEY (monitoria_id, curso_id) REFERENCES monitorias (id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT fk_participante_aluno_curso
          FOREIGN KEY (aluno_id, curso_id) REFERENCES alunos (usuario_id, curso_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    await queryInterface.addIndex('disciplinas', ['curso_id'], { name: 'ix_disciplina_curso' });
    await queryInterface.addIndex('alunos', ['curso_id'], { name: 'ix_aluno_curso' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE monitoria_participantes
        DROP CONSTRAINT fk_participante_aluno_curso,
        DROP CONSTRAINT fk_participante_monitoria_curso,
        DROP COLUMN curso_id;

      ALTER TABLE monitorias
        DROP CONSTRAINT fk_monitoria_disciplina_curso,
        DROP CONSTRAINT uq_monitoria_curso,
        DROP COLUMN curso_id;

      ALTER TABLE alunos
        DROP CONSTRAINT fk_aluno_curso,
        DROP CONSTRAINT uq_aluno_curso,
        DROP COLUMN curso_id,
        ADD COLUMN curso varchar(120);

      ALTER TABLE disciplinas
        DROP CONSTRAINT fk_disciplina_curso,
        DROP CONSTRAINT uq_disciplina_curso,
        DROP COLUMN curso_id;
    `);

    await queryInterface.dropTable('cursos');

    // O texto livre de `alunos.curso` nao volta: a informacao foi descartada
    // no backfill, por decisao registrada no cabecalho.
    void Sequelize;
  },
};
