Deno.serve(() => Response.json({error:"Legacy diagnostic disabled."},{status:410,headers:{"Cache-Control":"no-store"}}));
