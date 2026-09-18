const {Pool}=require("pg");
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&!process.env.DATABASE_URL.includes("localhost")?{rejectUnauthorized:false}:false});
const db=(q,p=[])=>pool.query(q,p);

module.exports={pool,db};
