'use strict';

/**
 * BOLETIM — o PDF de notas do candidato, em tabela PROPRIA.
 *
 * Decisao de armazenamento: BYTEA no PostgreSQL. O projeto nao tem camada de
 * objetos (AD-12/D-19 preve disco local, ainda nao implementado), e introduzir
 * uma para este caso significaria adicionar provedor, credenciais, politica de
 * expiracao e um segundo lugar de onde o dado pode desaparecer. O volume nao
 * justifica: um processo seletivo recebe dezenas a centenas de candidaturas por
 * semestre, com PDFs de poucas centenas de KB — ordem de grandeza de MB por
 * edital, dentro do que o backup logico do banco absorve sem mudanca de rotina.
 *
 * O ganho concreto e transacional: o PDF entra e sai junto com a inscricao, no
 * mesmo COMMIT. Com objeto externo existiriam dois estados de falha que aqui
 * simplesmente nao existem — arquivo gravado sem inscricao e inscricao gravada
 * sem arquivo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TABELA SEPARADA, E NAO UMA COLUNA EM `inscricoes_edital`
 *
 * E a parte que faz a decisao funcionar. A listagem administrativa pagina
 * candidaturas e nunca precisa dos bytes; se o BYTEA morasse na mesma linha,
 * qualquer `SELECT *` descuidado — o do ORM, inclusive — arrastaria megabytes
 * por pagina. Separado, o binario so e lido por quem faz JOIN de proposito:
 * uma unica rota, autenticada, que entrega um arquivo.
 *
 * `SET STORAGE EXTERNAL` desliga a tentativa de compressao do TOAST. PDF ja e
 * comprimido: comprimir de novo gasta CPU na escrita e na leitura para ganhar
 * quase nada.
 *
 * ---------------------------------------------------------------------------
 * O QUE O BANCO GARANTE SOZINHO
 *
 * As validacoes de upload (mime, tamanho, assinatura) vivem no controller e no
 * service, mas tres invariantes ficam aqui, porque um INSERT direto tambem tem
 * de respeita-las:
 *
 *  - `ck_boletim_pdf`: os primeiros bytes sao a assinatura `%PDF-`. O
 *    `Content-Type` do upload e informado pelo cliente e nao prova nada; a
 *    assinatura esta no conteudo.
 *  - `ck_boletim_tamanho`: `tamanho_bytes` descreve o que esta gravado
 *    (`octet_length`), em vez de ser um numero que alguem afirmou.
 *  - `ck_boletim_sha256`: 64 digitos hexadecimais minusculos. O hash existe
 *    para detectar corrupcao e identificar arquivos iguais enviados por
 *    candidatos diferentes, nao como seguranca.
 */
const LIMITE_BYTES = 5 * 1024 * 1024;

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('boletins', {
      /**
       * PK = FK: 1:0..1 impossivel de violar, o mesmo padrao de `alunos` e
       * `professores` sobre `usuarios` (AD-03). Nao existe boletim sem
       * candidatura, nem dois para a mesma.
       *
       * CASCADE no delete, diferente do RESTRICT usado no resto do projeto: o
       * boletim nao tem existencia propria nem valor historico separado da
       * candidatura. Nao e uma porta para apagar candidatura — a FK em
       * `inscricoes_edital` continua RESTRICT contra o edital.
       */
      inscricao_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'inscricoes_edital', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      conteudo: { type: Sequelize.BLOB, allowNull: false },

      /** Nome informado no upload. Sanitizado antes de gravar e ao servir. */
      nome_original: { type: Sequelize.STRING(255), allowNull: false },

      tamanho_bytes: { type: Sequelize.INTEGER, allowNull: false },

      /** SHA-256 em hexadecimal minusculo. */
      sha256: { type: Sequelize.CHAR(64), allowNull: false },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE boletins
        ALTER COLUMN conteudo SET STORAGE EXTERNAL,
        ADD CONSTRAINT ck_boletim_tamanho CHECK (
          tamanho_bytes > 0
          AND tamanho_bytes <= ${LIMITE_BYTES}
          AND octet_length(conteudo) = tamanho_bytes
        ),
        ADD CONSTRAINT ck_boletim_pdf CHECK (
          substring(conteudo from 1 for 5) = decode('255044462d', 'hex')
        ),
        ADD CONSTRAINT ck_boletim_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        ADD CONSTRAINT ck_boletim_nome CHECK (btrim(nome_original) <> '');
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('boletins');
  },
};
