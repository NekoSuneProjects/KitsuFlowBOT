import { e, h, card, grid, actions, btn, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

// Pokémon chat game settings, market and raids.
export async function pokemon() {
  const d = await api('/api/pokemon'),
    s = d.settings;
  const cfg = card(
    'Pokémon chat game',
    "Wild Pokémon spawn in chat while you are live. Viewers catch them with balls bought from the PokéShop using this channel's loyalty points. Pokédex and bags follow viewers across every KitsuFlowBOT channel."
  );
  const enabled = input('Enable the Pokémon game', s.enabled, 'checkbox');
  const minutes = input('Spawn a wild Pokémon every (minutes)', s.spawn_minutes, 'number');
  const globals = input('Join Global Raids', s.global_raids, 'checkbox');
  const genPicks = d.allGens.map(g => ({
    g,
    box: input('Gen ' + g, s.gens.includes(g), 'checkbox')
  }));
  const genRow = card(
    'Spawn generations',
    'Choose which generations appear as wild spawns and channel raid bosses (' +
      d.dexTotal +
      ' Pokémon total). Global raids always use every generation.'
  );
  genRow.append(grid('cols2', ...genPicks.map(x => x.box.node)));
  cfg.append(
    grid('cols2', enabled.node, minutes.node, globals.node),
    e(
      'p',
      'Status: ' +
        (d.spawn ? 'wild ' + d.spawn.name + ' in chat' : 'no wild Pokémon') +
        ' · ' +
        (d.raid
          ? (d.raid.global ? 'Global raid' : 'Raid') +
            ': ' +
            d.raid.boss +
            ' ' +
            d.raid.hp +
            '/' +
            d.raid.max +
            ' HP, ' +
            d.raid.players +
            ' trainers'
          : 'no raid'),
      'description'
    ),
    actions(
      btn(
        'Save Pokémon settings',
        async () => {
          await api('/api/pokemon', 'POST', {
            enabled: enabled.value(),
            spawn_minutes: minutes.value(),
            global_raids: globals.value(),
            gens: genPicks.filter(x => x.box.value()).map(x => x.g)
          });
          notify('Pokémon settings saved');
          await reloadView();
        },
        'primary'
      ),
      btn('Spawn wild Pokémon now', async () => {
        await api('/api/pokemon/spawn', 'POST', {});
        notify('A wild Pokémon appeared in chat');
        await reloadView();
      }),
      btn('Start channel raid', async () => {
        await api('/api/pokemon/raid', 'POST', {});
        notify('Raid started in chat');
        await reloadView();
      })
    )
  );
  const help = card(
    'Chat commands',
    'Catch: !pokecatch [ball] · !pokelure · Shop: !pokeshop · !pokebuy <item> [qty] · !pokebag · Collection: !pokebox · !pokedex [@user] · !poketop · Training: !pokeprimary <pokemon|#id> (gains XP from chatting, catching and raids; evolves at the right level) · !pokecandy · !pokeevolve [into] · Trading: !pokemarket [page|pokemon] · !pokesell <pokemon|#id> <price> · !pokemarket buy|cancel <id> · !poketrade @user <mine> for <theirs> · Raids: !pokeraid — Mods: !pokespawn, !pokeraidstart'
  );
  const market = card(
    'PokéMarket listings',
    'Pokémon viewers are selling in this channel for loyalty points.'
  );
  market.append(
    table(
      ['#', 'Pokémon', 'Price', 'Seller'],
      (d.market || []).map(x => ['#' + x.id, x.pokemon, x.price, x.seller])
    )
  );
  const parts = [cfg, genRow, help];
  if (d.operator) {
    const admin = card(
      'Global Raids (operator)',
      'Starts one raid boss with shared HP in every live channel that has the game and Global Raids on.' +
        (d.autoGlobalRaidHours
          ? ' Auto global raid every ' + d.autoGlobalRaidHours + 'h.'
          : ' Set POKEMON_GLOBAL_RAID_HOURS for automatic global raids.')
    );
    admin.append(
      actions(
        btn(
          'Start Global Raid',
          async () => {
            const r = await api('/api/admin/pokemon/global-raid', 'POST', {});
            notify('Global raid: ' + r.boss + ' in ' + r.channels + ' channel(s)');
            await reloadView();
          },
          'primary'
        )
      )
    );
    parts.push(admin);
  }
  const top = card('Top trainers in this channel');
  top.append(
    table(
      ['Trainer', 'Pokédex', 'Caught'],
      d.top.map(x => [x.login, x.uniq + '/' + d.dexTotal, x.total])
    )
  );
  const log = card('Recent Pokémon activity');
  log.append(
    table(
      ['When', 'Event', 'Details'],
      d.events.map(x => [x.created, x.kind, x.detail])
    )
  );
  return h('div', 'stack', ...parts, market, top, log);
}
