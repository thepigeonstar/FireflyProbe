export function withoutTelegramToken(settings){const {telegram_token,...safe}=settings;return safe;}
export function persistTelegramSettings(db,vault,settings){
 db.exec('BEGIN');try{
  if(settings.telegram_token)db.prepare("INSERT INTO settings VALUES('telegram_secret',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(vault.seal(settings.telegram_token,'telegram-token'));
  else db.prepare("DELETE FROM settings WHERE key='telegram_secret'").run();
  db.prepare("INSERT INTO settings VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(withoutTelegramToken(settings)));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function loadTelegramSettings(db,vault,settings){
 if(settings.telegram_token){persistTelegramSettings(db,vault,settings);}else{const row=db.prepare("SELECT value FROM settings WHERE key='telegram_secret'").get();settings.telegram_token=row?vault.open(row.value,'telegram-token'):'';}
 return settings;
}
