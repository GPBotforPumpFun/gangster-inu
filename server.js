const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'public');
const port = process.env.PORT || 3000;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if(url.pathname === '/health'){ res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true,app:'gangster-inu'})); }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if(!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(root, rel));
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(file,(err,stat)=>{
    if(err || !stat.isFile()){
      const fallback=path.join(root,'index.html');
      return fs.readFile(fallback,(e,data)=>{ if(e){res.writeHead(404);return res.end('Not found');} res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}); res.end(data); });
    }
    fs.readFile(file,(e,data)=>{if(e){res.writeHead(500);return res.end('Error');} const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public, max-age=31536000, immutable'});res.end(data);});
  });
});
server.listen(port,'0.0.0.0',()=>console.log(`Gangster Inu listening on ${port}`));
