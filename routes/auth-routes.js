const express=require("express");

function createAuthRouter({db,bcrypt,token,setCookie,auth}){
  const router=express.Router();

  router.post("/register",async(req,res)=>{try{let name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||"");if(name.length<2||!email.includes("@")||pw.length<6)return res.status(400).json({error:"Name, valid email and 6+ character password required."});if((await db("SELECT id FROM users WHERE email=$1",[email])).rowCount)return res.status(409).json({error:"Email already registered."});let r=await db("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,await bcrypt.hash(pw,12)]);await db("INSERT INTO accounts(user_id,name) VALUES($1,'Main Account')",[r.rows[0].id]);setCookie(res,token(r.rows[0]));res.json({user:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Registration failed."})}});
  router.post("/login",async(req,res)=>{try{let email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||""),r=await db("SELECT * FROM users WHERE email=$1",[email]);if(!r.rowCount||!(await bcrypt.compare(pw,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid email or password."});let u={id:r.rows[0].id,name:r.rows[0].name,email:r.rows[0].email};setCookie(res,token(u));res.json({user:u})}catch(e){res.status(500).json({error:"Login failed."})}});
  router.post("/logout",(req,res)=>{res.clearCookie("gt_token");res.json({ok:true})});router.get("/me",auth,(req,res)=>res.json({user:req.user}));

  return router;
}

module.exports={createAuthRouter};
