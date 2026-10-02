import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import OpenID from "openid";
import path from "path";
import {fileURLToPath} from "url";

dotenv.config();
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||3000);
const DEMO=String(process.env.DEMO_MODE).toLowerCase()==="true";
const TTL=Number(process.env.CACHE_TTL_SECONDS||120)*1000;
const cache=new Map();

app.set("trust proxy",1);
if(process.env.NODE_ENV==="production"&&(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.includes("CHANGE_ME")||process.env.SESSION_SECRET.includes("cambia-esto"))){
  console.error("Falta SESSION_SECRET segura en producción.");process.exit(1);
}
app.get("/healthz",(req,res)=>res.send("ok"));
app.use(express.json({limit:"1mb"}));
app.use(session({
  secret:process.env.SESSION_SECRET||"dev-only-change-me",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*86400000}
}));
app.use(express.static(path.join(__dirname,"public")));

function steamKey(){
  if(!process.env.STEAM_API_KEY) throw new Error("STEAM_API_KEY no está configurada.");
  return process.env.STEAM_API_KEY;
}
async function getJSON(url,headers={}){
  const r=await fetch(url,{headers});
  if(r.status===403) throw new Error("Steam denegó el acceso (403). Revisa que tu perfil e inventario estén en público y que la API Key sea válida.");
  if(r.status===429) throw new Error("Steam limitó las solicitudes (429). Espera un minuto e inténtalo de nuevo.");
  if(!r.ok) throw new Error(`Steam respondió HTTP ${r.status}`);
  return r.json();
}
async function cached(key,fn){
  const x=cache.get(key);
  if(x && Date.now()-x.t<TTL) return x.v;
  const v=await fn(); cache.set(key,{t:Date.now(),v}); return v;
}
function currentId(req){return DEMO?"76561198000000000":req.session.steamid||null}
function claimedToId(v){const m=String(v||"").match(/\/id\/(\d+)$/);return m?.[1]||null}
function marketLink(name){return "https://steamcommunity.com/market/listings/753/"+encodeURIComponent(name)}

async function profile(id){
  if(DEMO)return {steamid:id,personaname:"Demo Steam User",avatar:"",profileurl:"#",communityvisibilitystate:3};
  const k=steamKey();
  const d=await cached("profile:"+id,()=>getJSON(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(k)}&steamids=${id}`));
  const p=d.response?.players?.[0]; if(!p)throw new Error("No se encontró el perfil.");
  return p;
}
async function level(id){
  if(DEMO)return 18;
  const k=steamKey();
  const d=await cached("level:"+id,()=>getJSON(`https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${encodeURIComponent(k)}&steamid=${id}`));
  return d.response?.player_level??null;
}
async function games(id){
  if(DEMO)return [{appid:730,name:"Counter-Strike 2",playtime_forever:1200},{appid:440,name:"Team Fortress 2",playtime_forever:700},{appid:570,name:"Dota 2",playtime_forever:2200}];
  const k=steamKey();
  const d=await cached("games:"+id,()=>getJSON(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(k)}&steamid=${id}&include_appinfo=true&include_played_free_games=true`));
  return d.response?.games||[];
}
async function inventory(id){
  if(DEMO)return {
    total_inventory_count:6,
    assets:[],
    descriptions:[
      {classid:"1",instanceid:"0",market_hash_name:"Counter-Strike 2 Trading Card SWAT",market_name:"SWAT",name:"SWAT",type:"Trading Card",marketable:1,tradable:1,tags:[{category_name:"Item Type",name:"Trading Card"}]},
      {classid:"2",instanceid:"0",market_hash_name:"Team Fortress 2 Trading Card SNIPER",market_name:"SNIPER",name:"SNIPER",type:"Trading Card",marketable:1,tradable:1,tags:[{category_name:"Item Type",name:"Trading Card"}]}
    ]
  };
  return cached("inventory:"+id,async()=>{
    const out={total_inventory_count:0,assets:[],descriptions:[]};
    let last=null;
    for(let page=0;page<20;page++){
      const url=`https://steamcommunity.com/inventory/${id}/753/6?l=english&count=2000`+(last?`&start_assetid=${last}`:"");
      const d=await getJSON(url,{"User-Agent":"SteamCardOptimizer/3.0"});
      if(!d||d.success===0||d.success===false) throw new Error("No se pudo leer el inventario. Debe estar público en Steam.");
      out.total_inventory_count=d.total_inventory_count||out.total_inventory_count;
      out.assets.push(...(d.assets||[]));
      out.descriptions.push(...(d.descriptions||[]));
      if(d.more_items&&d.last_assetid) last=d.last_assetid; else break;
    }
    return out;
  });
}
function parseCards(inv){
  const qty=new Map();
  for(const a of inv.assets||[]){const k=a.classid+"_"+a.instanceid;qty.set(k,(qty.get(k)||0)+Number(a.amount||1))}
  const seen=new Set();
  return (inv.descriptions||[]).filter(x=>{
    const s=String(x.type||"")+" "+(x.tags||[]).map(t=>`${t.category_name||""} ${t.name||""}`).join(" ");
    const k=x.classid+"_"+x.instanceid;
    if(!/trading card/i.test(s)||seen.has(k))return false;
    seen.add(k);return true;
  }).map(x=>({
    classid:x.classid,instanceid:x.instanceid,market_hash_name:x.market_hash_name,
    market_name:x.market_name,name:x.name,icon:x.icon_url_large||x.icon_url||"",
    amount:qty.get(x.classid+"_"+x.instanceid)||1,
    marketable:Boolean(x.marketable),tradable:Boolean(x.tradable)
  }));
}
async function price(name){
  const country=process.env.MARKET_COUNTRY||"US";
  const currency=process.env.MARKET_CURRENCY||"1";
  const url=`https://steamcommunity.com/market/priceoverview/?appid=753&country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}&market_hash_name=${encodeURIComponent(name)}`;
  return cached("price:"+name,async()=>{
    try{
      const d=await getJSON(url,{"User-Agent":"SteamCardOptimizer/3.0"});
      return {success:Boolean(d.success),lowest_price:d.lowest_price||null,median_price:d.median_price||null,volume:d.volume||null};
    }catch{return {success:false,lowest_price:null,median_price:null,volume:null}}
  });
}

/* OpenID login */
app.get("/auth/steam",(req,res)=>{
  if(DEMO)return res.redirect("/");
  const rp=new OpenID.RelyingParty(
    process.env.STEAM_RETURN_URL||`http://localhost:${PORT}/auth/steam/return`,
    process.env.STEAM_REALM||`http://localhost:${PORT}/`,true,false
  );
  rp.authenticate("https://steamcommunity.com/openid",false,(err,url)=>{
    if(err||!url)return res.status(500).send("No se pudo iniciar Steam OpenID.");
    res.redirect(url);
  });
});
app.get("/auth/steam/return",(req,res)=>{
  const rp=new OpenID.RelyingParty(
    process.env.STEAM_RETURN_URL||`http://localhost:${PORT}/auth/steam/return`,
    process.env.STEAM_REALM||`http://localhost:${PORT}/`,true,false
  );
  rp.verifyAssertion(req,(err,result)=>{
    if(err||!result?.authenticated)return res.status(401).send("Autenticación Steam fallida.");
    const id=claimedToId(result.claimedIdentifier);
    if(!id)return res.status(400).send("SteamID64 no encontrado.");
    req.session.steamid=id;
    res.redirect("/");
  });
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me",async(req,res)=>{
  try{
    const id=currentId(req); if(!id)return res.json({authenticated:false});
    const [p,l]=await Promise.all([profile(id),level(id)]);
    res.json({authenticated:true,profile:{...p,level:l},demo:DEMO});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get("/api/inventory",async(req,res)=>{
  try{
    const id=currentId(req); if(!id)return res.status(401).json({error:"Inicia sesión con Steam."});
    const inv=await inventory(id);
    res.json({count:inv.total_inventory_count||0,cards:parseCards(inv)});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get("/api/games",async(req,res)=>{
  try{
    const id=currentId(req); if(!id)return res.status(401).json({error:"Inicia sesión con Steam."});
    res.json({games:await games(id)});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get("/api/market/price",async(req,res)=>{
  try{
    const name=String(req.query.name||"").trim(); if(!name)return res.status(400).json({error:"name requerido"});
    res.json({market_hash_name:name,url:marketLink(name),price:await price(name)});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get("/api/market/link",(req,res)=>{
  const name=String(req.query.name||"").trim(); if(!name)return res.status(400).json({error:"name requerido"});
  res.json({url:marketLink(name)});
});

app.get("/api/dashboard",async(req,res)=>{
  try{
    const id=currentId(req); if(!id)return res.status(401).json({error:"Inicia sesión con Steam."});
    const [p,l,g,inv]=await Promise.allSettled([profile(id),level(id),games(id),inventory(id)]);
    if(p.status==="rejected")throw p.reason;
    const warnings=[];
    if(g.status==="rejected")warnings.push("Juegos: "+g.reason.message);
    if(inv.status==="rejected")warnings.push("Inventario: "+inv.reason.message);
    const invv=inv.status==="fulfilled"?inv.value:{};
    res.json({profile:{...p.value,level:l.status==="fulfilled"?l.value:null},
      games:g.status==="fulfilled"?g.value:[],
      inventory_count:invv.total_inventory_count||0,cards:parseCards(invv),warnings,demo:DEMO});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get("/api/config",(req,res)=>res.json({
  demo:DEMO,apiKeyConfigured:Boolean(process.env.STEAM_API_KEY),
  returnUrl:process.env.STEAM_RETURN_URL||`http://localhost:${PORT}/auth/steam/return`
}));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Steam Card Optimizer running on http://localhost:${PORT}`));
