// Opening the app's own state to mods.
//
// The pet's place, and the places of the other players' pets, are variables inside the app's own scripts: no
// command sets them, no element holds them (the page is drawn from them, so editing the page changes nothing the
// app knows about), and the saved place is read once, when the app starts. The only ways to move a pet from
// outside are to pretend to be the mouse (which breaks whenever the real mouse moves too) or to be inside the
// script. This is the second: the script the app loads is changed on its way into the page, a few statements are
// added that hand out what a mod needs, and nothing else is touched. The file on disk is never changed.
//
// What is handed out, under `window.__wuwaApp` (mods use it through `mod.app`, see docs/MODDING.md):
//   pet       { left, top }           the Vue refs of the person's own pet's place (read .value, or set it)
//   members   { list, place, clamp }  the other players' pets in the room
//   events    `wuwa-pet-dragged`, `wuwa-member-dragged` {id}   the person let go of a pet they had dragged
//
// The scripts are minified, so what is looked for is the shape of a function and the names of what it returns
// (property names survive minifying, local names do not). A rule that does not find its shape is reported as
// missing and nothing is added for it: a mod then sees that the app does not offer it (`mod.app.available`) and
// does without, instead of the app being broken. Every added piece is a statement of its own, put before or after
// a whole statement, so that what it does not find cannot change what the app does.

const ID = '[\\w$]+';

// Every rule: `name`, `find` (a RegExp on the whole script) and `build(match)` -> { at, text }, where `at` is an
// index in the script (before the match, or after a part of it) and `text` what is inserted there.
export const RULES = [
  {
    // The composable that owns the person's pet: `return{dockLeft:C,dockTop:F,...,clampDockPositionIfNeeded:X,...}`.
    name: 'pet',
    find: new RegExp(`return\\{dockLeft:(${ID}),dockTop:(${ID}),`),
    build: m => ({
      at: m.index,
      text: `;(window.__wuwaApp??={}).pet={left:${m[1]},top:${m[2]}};`,
    }),
    // Only at a statement boundary: after `}` or `;`.
    boundary: true,
  },
  {
    // The person let go of their own pet after dragging it (the drag-end function reads `movedDuringDrag` first).
    name: 'pet-dragged',
    find: new RegExp(`async function ${ID}\\(\\)\\{if\\(!(${ID})\\.value\\)\\{${ID}\\(\\);return\\}const (${ID})=(${ID})\\.value,${ID}=${ID};`),
    build: m => ({
      at: m.index + m[0].length,
      text: `${m[2]}&&setTimeout(()=>window.dispatchEvent(new CustomEvent("wuwa-pet-dragged")),400);`,
    }),
  },
  {
    // The other players' pets. The function that ends the drag of one of them: it reads the id of the pet being
    // dragged, takes it out of the set of pets the app places by itself, clamps, and sets the member's place.
    name: 'members',
    find: new RegExp(
      `function (${ID})\\(\\)\\{const (${ID})=(${ID})\\.value;if\\(\\2===null\\)return;` +
      `const (${ID})=${ID}\\+${ID},(${ID})=${ID}\\+${ID};` +
      `\\(Math\\.abs\\(${ID}\\)>\\.5\\|\\|Math\\.abs\\(${ID}\\)>\\.5\\)&&(${ID})\\.delete\\(\\2\\);` +
      `const ${ID}=(${ID})\\(\\4,\\5\\),(${ID})=(${ID})\\.value\\.find\\(`,
    ),
    // The rest of the function says what tells that a member can be dragged (`m&&draggable(m)&&`); the two small
    // functions that read and write the place the page is drawn from sit side by side:
    //   function where(e){return store(e).value}function write(e,t){const o=store(e);o.value={...o.value,...t}}
    build(m, script) {
      const [, , , , , , auto, clamp, member, list] = m;
      const rest = script.slice(m.index, m.index + 2600);
      const draggable = new RegExp(`${esc(member)}&&(${ID})\\(${esc(member)}\\)&&`).exec(rest);
      const pair = new RegExp(
        `function (${ID})\\((${ID})\\)\\{return (${ID})\\(\\2\\)\\.value\\}` +
        `function (${ID})\\(\\2,(${ID})\\)\\{const (${ID})=\\3\\(\\2\\);\\6\\.value=\\{\\.\\.\\.\\6\\.value,\\.\\.\\.\\5\\}\\}`,
      ).exec(script);
      if (!draggable || !pair) return null;
      const [, where, , , write] = pair;
      return {
        at: m.index,
        text: `;(window.__wuwaApp??={}).members={` +
          `list:()=>${list}.value,` +
          `where:m=>({...${where}(m)}),` +
          `draggable:m=>!!${draggable[1]}(m),` +
          `place:(id,left,top)=>{const m=${list}.value.find(x=>String(x.id)===String(id));if(!m||!${draggable[1]}(m))return false;` +
          `${auto}.delete(m.id);m.left=left;m.top=top;${write}(m,{left,top});return true},` +
          `clamp:(left,top)=>${clamp}(left,top)};`,
      };
    },
    boundary: true,
  },
  {
    // The person let go of another player's pet after dragging it: the first thing the drag-end function does
    // after it knows which pet it was.
    name: 'member-dragged',
    find: new RegExp(`function ${ID}\\(\\)\\{const (${ID})=${ID}\\.value;if\\(\\1===null\\)return;const ${ID}=${ID}\\+${ID},${ID}=${ID}\\+${ID};\\(Math\\.abs\\(${ID}\\)>\\.5\\|\\|Math\\.abs\\(${ID}\\)>\\.5\\)&&${ID}\\.delete\\(\\1\\);`),
    build: m => ({
      at: m.index + m[0].length,
      text: `setTimeout(()=>window.dispatchEvent(new CustomEvent("wuwa-member-dragged",{detail:{id:${m[1]}}})),400);`,
    }),
  },
];

function esc(text) {
  return text.replace(/[$]/g, '\\$&');
}

// The script with what it can be given added. Returns { text, applied: [name], missing: [name] }; `text` is the
// script as it was when nothing applied.
export function patchScript(script) {
  const applied = [];
  const missing = [];
  const edits = [];
  for (const rule of RULES) {
    const match = rule.find.exec(script);
    const edit = match ? rule.build(match, script) : null;
    if (!edit || (rule.boundary && !/[};]$/.test(script.slice(Math.max(0, edit.at - 40), edit.at).trimEnd()))) {
      missing.push(rule.name);
      continue;
    }
    edits.push(edit);
    applied.push(rule.name);
  }
  // From the end, so that the places of the earlier ones stay where they were found.
  let text = script;
  for (const { at, text: added } of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, at) + added + text.slice(at);
  return { text, applied, missing };
}

// Is this script one that can hold any of it: the app's main window script is the one with the pet in it.
export const mayHoldPet = script => script.includes('dockLeft:') && script.includes('data-room-cat-id');
