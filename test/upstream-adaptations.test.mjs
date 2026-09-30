import assert from 'node:assert/strict';
import {test} from 'node:test';
import {membershipNameMatches as matches} from '../scripts/service-membership.mjs';
import {terminalContext,sameTerminalContext} from '../scripts/terminal-context.mjs';
test('Provider name boundaries, Russian/Babele names, exact custom contracts',()=>{
 assert.ok(matches('Траума Тим — подписка','trauma'));
 for(const [name,service] of [['R.E.O. Membership','reo'],['REO Membership','reo'],['Подписка Мясовозки','reo'],['Травма-Тим — полис Серебро','trauma'],['Trauma Team Membership','trauma']])assert.ok(matches(name,service),name);
 for(const name of ['Oreo Membership','preorder membership','REO badge','xREO Membership','Trauma Team uniform'])assert.equal(matches(name,'reo'),false,name);
 assert.equal(matches('Травма Тим аптечка','trauma'),false);
 assert.ok(matches('Серебряный контракт','trauma','Золотой контракт; Серебряный контракт'));
 assert.equal(matches('Серебряный контракт (копия)','trauma','Серебряный контракт'),false);
 assert.equal(matches('Membership','reo',''),false);
});
test('Terminal awaits cannot continue after character or scene changes',()=>{
 const u={id:'p',character:{uuid:'Actor.a'},viewedScene:'s'},saved=terminalContext(u);
 assert.ok(sameTerminalContext(saved,u));
 assert.equal(sameTerminalContext(saved,{...u,character:{uuid:'Actor.b'}}),false);
 assert.equal(sameTerminalContext(saved,{...u,viewedScene:'elsewhere'}),false);
 assert.equal(sameTerminalContext(saved,null),false);
});
