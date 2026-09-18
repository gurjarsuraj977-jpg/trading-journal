const jwt=require("jsonwebtoken");

module.exports=({SECRET})=>{
  return function auth(req,res,next){const t=req.cookies.gt_token;if(!t)return res.status(401).json({error:"Not authenticated"});try{req.user=jwt.verify(t,SECRET);next()}catch{return res.status(401).json({error:"Session expired"})}}
};
