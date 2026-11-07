import { expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { FakeProvider } from "../llm/fake.js";

it("registers entity image generation in the actual application", async () => {
  const {db,sqlite}=createDb(":memory:");
  const c=new CampaignService(db).create({name:"Тест"});
  const d=new DocumentService(db).create({campaignId:c.id,type:"npc",title:"Смотритель"});
  const dataUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=";
  const app=buildApp({db,llm:new FakeProvider(["ok"]),imageGenerator:{async generate(){return {name:"npc.png",dataUrl};}}});
  try {
    const response=await app.inject({method:"POST",url:`/api/documents/${d.id}/image-generation`,payload:{prompt:"Акварельный портрет"}});
    expect(response.statusCode).toBe(202);
    await expect.poll(async()=> (await app.inject({method:"GET",url:`/api/documents/${d.id}/image-generation`})).json().running).toBe(false);
    const images=(await app.inject({method:"GET",url:`/api/documents/${d.id}/images`})).json();
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("npc.png");
    expect((await app.inject({method:"GET",url:`/api/images/${images[0].id}`})).rawPayload).toEqual(Buffer.from(dataUrl.split(",")[1],"base64"));
  } finally {await app.close();sqlite.close();}
});
