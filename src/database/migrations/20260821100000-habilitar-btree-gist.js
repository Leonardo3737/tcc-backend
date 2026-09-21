'use strict';

/**
 * btree_gist permite combinar, em um mesmo indice GiST, operadores de igualdade
 * (=) sobre tipos escalares com operadores de sobreposicao (&&) sobre ranges.
 *
 * E o que torna possiveis as constraints EXCLUDE que garantem a RN03:
 * "o monitor X nao pode ter dois atendimentos cujos intervalos se cruzem"
 * exige justamente `participante_id WITH =` junto de `tstzrange(...) WITH &&`.
 *
 * Sem isso, RN03 so poderia ser verificada com SELECT antes do INSERT — o que
 * falha sob concorrencia, porque duas requisicoes simultaneas passam pela
 * verificacao antes de qualquer uma gravar.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('SELECT 1;');
  },
};
