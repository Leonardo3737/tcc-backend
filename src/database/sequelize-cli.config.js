/**
 * Configuracao consumida exclusivamente pelo sequelize-cli (migrations e seeders).
 *
 * A aplicacao NestJS nao usa este arquivo: ela monta a conexao em
 * src/database/database.module.ts a partir do ConfigService ja validado.
 * Ambos leem as mesmas variaveis de ambiente, entao nao ha divergencia possivel
 * entre o schema migrado e o schema que a aplicacao espera.
 */
require('dotenv').config();

const base = {
  dialect: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
};

module.exports = {
  development: base,
  test: { ...base, database: `${process.env.DB_NAME}_test` },
  production: {
    ...base,
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
    },
  },
};
