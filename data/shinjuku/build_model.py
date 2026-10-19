#!/usr/bin/env python3
"""新宿駅の下書きモデル（gyrotraffic-station-v0）を公開データから組み立てる。

入力（このリポジトリには入れない。各自で取得する）:
  --tmg   東京都「新宿駅の施設情報及び移動ルート情報」(CC BY 4.0) shisetsu_root.zip を展開したフォルダ
          https://www.toshiseibi.metro.tokyo.lg.jp/kiban/shinjuku_terminal/pdf/shisetsu_root.zip
  --mlit  国土交通省「新宿駅周辺屋内地図オープンデータ（令和2年度更新版）_統合版（Shapefile）」を展開したフォルダ
          (政府標準利用規約 2.0 / CC BY 4.0 互換。G空間情報センターではユーザ登録・ログインのうえ取得するよう案内されている)
  --osm   (任意) Overpass API の JSON。件数の照合にだけ使い、モデルには混ぜない（ODbL）。
使い方: python3 build_model.py --tmg DIR --mlit DIR [--osm FILE] --out shinjuku-station.json --stats stats.json
pyshp (pip install pyshp) が要る。
"""
import argparse, glob, json, math, os, collections as C

LAT0, LON0 = 35.6900, 139.7000   # 局所座標の原点（任意に決めた点。x=東、y=北、単位 m）
W17 = 256 * 2 ** 17              # TMG の v5_nav.json の mx/my はズーム17 のウェブメルカトル画素（dm との照合で倍率 0.1% 以内）
WALK = 1.2                       # 歩く速さ m/s（仮の値）
LEVEL_H = 5.0                    # 階の高さ m（仮の値。実際の階高は資料になし）

def xy(lon, lat):
    return (round((lon - LON0) * 111320.0 * math.cos(math.radians(LAT0)), 2),
            round((lat - LAT0) * 110574.0, 2))

def px2ll(mx, my):
    return mx / W17 * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * my / W17))))

def centroid(geom):
    t = geom['type']; cs = geom['coordinates']
    pts = cs if t == 'Point' and False else (cs[0] if t == 'Polygon' else cs[0][0] if t == 'MultiPolygon' else cs if t == 'LineString' else [cs])
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)

def ring(geom):
    t = geom['type']; cs = geom['coordinates']
    r = cs[0] if t == 'Polygon' else cs[0][0] if t == 'MultiPolygon' else None
    return [list(xy(*p)) for p in r] if r else None

TMG_SRC = 'tmg'
KIND = {'stairs': 'stairs', 'escalator': 'escalator', 'elevator': 'elevator', 'bathroom': 'toilet',
        'universalaccesstoilet': 'toilet', 'gate': 'gate', 'section': 'platform', 'movingwalkway': 'movingwalk',
        'ramp': 'ramp', 'step': 'step'}

# ---- 東京都と国交省の突き合わせ ----------------------------------------------------------
MLIT_LEVEL = {'0': '1F', '1': '1F', '2': '2F', '2out': '2F', '3': '3F', '3out': '3F', '4': '4F', '4out': '4F',
              'B1': 'B1F', 'B2': 'B2F', 'B3': 'B3F'}
MLIT_KIND = {'F001': ('toilet', 'male'), 'F002': ('toilet', 'female'), 'F003': ('toilet', 'unisex'),
             'F004': ('toilet', None), 'F005': ('toilet', 'multi'), 'F006': ('toilet', 'multi'),
             'F007': ('toilet', 'multi'), 'F008': ('toilet', 'multi'),
             'F011': ('stairs', None), 'F012': ('elevator', None), 'F013': ('escalator', None), 'F106': ('gate', None)}
MATCH_M, NEAR_M, KIND_M = 5.0, 15.0, 2.0     # 一致とみなす距離・位置の食い違いとして挙げる距離・種類の食い違いを疑う距離
MID_LEVELS = {'M1F', 'MB2F', 'B4F', 'B5F'}    # 国交省データにない階

def _rings(geom):
    t = geom['type']; cs = geom['coordinates']
    if t == 'Point': return [[xy(*cs)]]
    if t == 'Polygon': return [[xy(*p) for p in cs[0]]]
    if t == 'MultiPolygon': return [[xy(*p) for p in poly[0]] for poly in cs]
    return []

def _pin(pt, poly):
    x, y = pt; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: c = not c
    return c

def _seg(p, a, b):
    ax, ay = a; bx, by = b; px, py = p; dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def _pdist(pt, rings):
    best = 1e9
    for r in rings:
        if len(r) == 1: best = min(best, math.hypot(pt[0] - r[0][0], pt[1] - r[0][1])); continue
        if _pin(pt, r): return 0.0
        best = min(best, min(_seg(pt, r[i - 1], r[i]) for i in range(len(r))))
    return best

def _tmg_gender(p, c):
    if c == 'universalaccesstoilet': return 'multi'
    g = p.get('gender')
    return {'family': 'multi', 'kidstoilet': 'multi'}.get(g, g)

def crosscheck(mlit_dir, F, cat, nodes, shapefile):
    """国交省の設備 POI（点）1 件ずつに、東京都の施設の多角形を同じ階・同じ種類で突き合わせる。"""
    tm = {}
    for gid, (lv, x) in F.items():
        p = x['properties']; c = cat(p); k = KIND.get(c)
        if k not in ('toilet', 'stairs', 'escalator', 'elevator', 'gate'): continue
        tm[gid] = {'lv': lv, 'k': k, 'g': _tmg_gender(p, c) if k == 'toilet' else None, 'r': _rings(x['geometry'])}
    pts = []
    for f in sorted(glob.glob(os.path.join(mlit_dir, 'ShinjukuTerminal', '*_Facility.shp'))):
        tag = os.path.basename(f)[len('ShinjukuTerminal_'):-len('_Facility.shp')]
        for sr in shapefile.Reader(f[:-4], encoding='utf-8').shapeRecords():
            kg = MLIT_KIND.get(sr.record['category'])
            if not kg: continue
            pts.append({'id': sr.record['id'], 'k': kg[0], 'g': kg[1], 'lv': MLIT_LEVEL[tag], 'tag': tag,
                        'p': xy(*sr.shape.points[0])})
    rows = []; matched = {}; s = C.Counter()
    for q in pts:
        same = sorted((_pdist(q['p'], t['r']), gid) for gid, t in tm.items() if t['k'] == q['k'] and t['lv'] == q['lv'])
        if q['k'] == 'toilet' and q['g']:   # 男女が合う物を先に（男子と女子のトイレが隣り合うため）
            same.sort(key=lambda dg: (dg[0] > MATCH_M, tm[dg[1]]['g'] not in (q['g'], None, 'unisex'), dg[0]))
        d, gid = same[0] if same else (1e9, None)
        if d <= MATCH_M:
            t = tm[gid]
            if q['k'] == 'toilet' and q['g'] and t['g'] and q['g'] != t['g'] and 'unisex' not in (q['g'], t['g']):
                res, note = '種類の食い違い', '男女・多機能の区別が違う（国交省 %s／東京都 %s）' % (q['g'], t['g'])
            else:
                res, note = '一致', ''
                # 同じ階・同じ種類・5 m 以内の東京都の多角形はすべて一致とみなす（1 基が複数の多角形に分かれることがあるため）
                for dd, g2 in same:
                    if dd > MATCH_M: break
                    if g2 not in matched or matched[g2][1] > dd: matched[g2] = (q['id'], round(dd, 2))
            rows.append([res, q['k'], t['lv'], q['lv'], round(d, 2), gid, q['id'], q['p'][0], q['p'][1], note]); s[(q['k'], res)] += 1
            continue
        other = sorted((_pdist(q['p'], t['r']), gid) for gid, t in tm.items() if t['k'] == q['k'] and t['lv'] != q['lv'])
        od, ogid = other[0] if other else (1e9, None)
        if d <= NEAR_M:
            res, note, g, dd = '位置の食い違い', '同じ階・同じ種類で %.1f m 離れている' % d, gid, d
        elif od <= MATCH_M:
            lv = tm[ogid]['lv']
            res = '階の食い違い'
            note = ('東京都では %s（国交省のデータにこの階はない）' % lv) if lv in MID_LEVELS else '東京都では %s' % lv
            if q['k'] in ('stairs', 'escalator', 'elevator'): note += '。上下の階をつなぐ設備なので、どちらの階の代表点とするかの違いの可能性'
            g, dd = ogid, od
        else:
            kd = sorted((_pdist(q['p'], t['r']), gid) for gid, t in tm.items() if t['k'] != q['k'] and t['lv'] == q['lv'])
            if kd and kd[0][0] <= KIND_M:
                res, g, dd = '種類の食い違い', kd[0][1], kd[0][0]
                note = '同じ場所に東京都では %s がある' % tm[g]['k']
            else:
                res, note, g, dd = '国交省のみ', '東京都に同じ種類の物が近く（%d m 以内・同じ階）にない' % NEAR_M, None, None
        rows.append([res, q['k'], tm[g]['lv'] if g else '', q['lv'], round(dd, 2) if dd is not None else '', g or '', q['id'],
                     q['p'][0], q['p'][1], note]); s[(q['k'], res)] += 1
    for gid, t in tm.items():
        if gid in matched: continue
        lvs = {q['lv'] for q in pts if q['k'] == t['k'] and _pdist(q['p'], t['r']) <= MATCH_M}
        if lvs:
            res, note = '一致（階は別）', '国交省では %s に同じ種類の点がある。位置は合うが階は合わない' % '・'.join(sorted(lvs))
        elif t['lv'] in MID_LEVELS:
            res, note = '東京都のみ', '国交省のデータにない階（%s）' % t['lv']
        else:
            res, note = '東京都のみ', '国交省に同じ種類の点が近く（同じ階・%d m 以内）にない' % MATCH_M
        c = t['r'][0]; cx = sum(p[0] for p in c) / len(c); cy = sum(p[1] for p in c) / len(c)
        rows.append([res, t['k'], t['lv'], '', '', gid, '', round(cx, 2), round(cy, 2), note]); s[(t['k'], res)] += 1
    s[('*', '東京都で一致した多角形')] = len(matched)
    for n in nodes:
        g = n.get('srcGeom') if n['id'].startswith('T') and not n['id'].startswith('TG') else n.get('srcId') if n['id'].startswith('TG') else None
        if g in matched:
            n['basis'] = '複数出典で一致'
            n['basisNote'] = '国交省の設備 POI %s と同じ階・同じ種類・%.1f m（東京都の多角形からの距離）。現地未確認なので conf は推' % (matched[g][0][:10], matched[g][1])
    summ = C.defaultdict(dict)
    for (k, r), v in s.items(): summ[k][r] = v
    return rows, dict(summ)

# ---- 歩行ネットワークの切れ目を直す（推測の接続はすべて「推」・guess:true） ----------------------
SHAFT_M, SPLIT_M, BRIDGE_M, TOILET_M, END_M = 3.0, 1.0, 5.0, 10.0, 10.0

def _components(nodes, edges):
    par = {n['id']: n['id'] for n in nodes}
    def f(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for e in edges: par[f(e['a'])] = f(e['b'])
    g = C.defaultdict(list)
    deg = C.Counter()
    for e in edges: deg[e['a']] += 1; deg[e['b']] += 1
    for n in nodes:
        if deg[n['id']]: g[f(n['id'])].append(n)
    return sorted(g.values(), key=len, reverse=True)

def fix_network(nodes, edges, platforms, amap, inside, log):
    order = {}
    by_id = {n['id']: n for n in nodes}
    def add(a, b, kind, reason, m=None):
        d = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
        e = {'a': a['id'], 'b': b['id'], 'kind': kind, 'src': 'derived-fix', 'conf': '推', 'guess': True, 'reason': reason,
             'basis': '東京都データの位置から機械的に推定（現地・事業者未確認）'}
        if a['level'] != b['level']:   # 上下の辺は水平距離が 0 に近いので、仮の階の高さ（5 m 刻み）を足した長さにする
            d = math.hypot(d, LEVEL_H * abs(LEVEL_ORDER.index(a['level']) - LEVEL_ORDER.index(b['level'])))
            e['mNote'] = '長さは仮の階の高さ（5 m 刻み）から出した目安。実際の長さ・所要時間は不明'
        e['m'] = round(d, 2); e['sec'] = round(d / WALK, 1)
        edges.append(e)
        for n in (a, b):
            if n.get('networked') is False: n['networked'] = True; n['netSrc'] = 'derived-fix'
        return d
    lv_order = {}
    # 1) 同じ昇降路・同じ階段：別の階で水平に重なる同じ種類の点（エレベーター 3 m・階段とエスカレーター 1 m 以内）は、
    #    1 基の設備が階ごとの多角形に分かれたものとみなし、上下に並ぶ階どうしを結ぶ。元のネットワークにある所は足さない
    orig_net = {n['id'] for n in nodes if n.get('networked', True)}
    for kind, lim in (('elevator', SHAFT_M), ('stairs', SPLIT_M), ('escalator', SPLIT_M)):
        els = [n for n in nodes if n['kind'] == kind and n['src'] == TMG_SRC]
        par = list(range(len(els)))
        def f(i):
            while par[i] != i: par[i] = par[par[i]]; i = par[i]
            return i
        for i in range(len(els)):
            for j in range(i + 1, len(els)):
                if els[i]['level'] != els[j]['level'] and math.hypot(els[i]['x'] - els[j]['x'], els[i]['y'] - els[j]['y']) <= lim:
                    par[f(i)] = f(j)
        groups = C.defaultdict(list)
        for i, n in enumerate(els): groups[f(i)].append(n)
        linked = {(e['a'], e['b']) for e in edges} | {(e['b'], e['a']) for e in edges}
        for grp in groups.values():
            lvs = sorted({n['level'] for n in grp}, key=LEVEL_ORDER.index)
            if len(lvs) < 2 or all(n['id'] in orig_net for n in grp): continue
            for l1, l2 in zip(lvs, lvs[1:]):
                A = [n for n in grp if n['level'] == l1]; B = [n for n in grp if n['level'] == l2]
                if any((x['id'], y['id']) in linked for x in A for y in B): continue
                a = min(A, key=lambda n: n['id'] in orig_net); b = min(B, key=lambda n: n['id'] in orig_net)
                if a['id'] in orig_net and b['id'] in orig_net: continue
                hd = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
                e_reason = {'elevator': 'エレベーターの同じ昇降路（%s と %s の多角形が水平 %.1f m 以内で重なる）。止まる階かは未確認',
                            'stairs': '同じ階段（%s と %s の多角形が水平 %.1f m で重なる。1 つの階段が階ごとに分かれたものと推定）',
                            'escalator': '同じエスカレーター（%s と %s の多角形が水平 %.1f m で重なる）。運転の向きは不明なので一方通行にしていない'}[kind]
                add(a, b, kind, e_reason % (l1, l2, hd), m=None)
                log[kind + '_split_edges'] += 1
    # 1b) 上でつないだ点のうち、ホームの外にあって元のネットワークにまだ届かない端を、同じ階の 10 m 以内の通路の点に結ぶ
    plat_polys = [(amap[P['area']]['level'], amap[P['area']]['poly']) for P in platforms]
    in_plat = lambda n: any(lv == n['level'] and inside((n['x'], n['y']), poly) for lv, poly in plat_polys)
    base = [n for n in nodes if n['id'] in orig_net and n['kind'] != 'exit' and not in_plat(n)]
    for n in [n for n in nodes if n.get('netSrc') == 'derived-fix' and not in_plat(n)]:
        b = min((q for q in base if q['level'] == n['level']), key=lambda q: (q['x'] - n['x']) ** 2 + (q['y'] - n['y']) ** 2, default=None)
        if b and math.hypot(b['x'] - n['x'], b['y'] - n['y']) <= END_M:
            add(n, b, 'walk', '上の推定でつないだ%sの端を、同じ階のいちばん近い通路の点（%.1f m）に直線で結んだ'
                % ({'stairs': '階段', 'escalator': 'エスカレーター', 'elevator': 'エレベーター'}[n['kind']], math.hypot(b['x'] - n['x'], b['y'] - n['y'])))
            log['split_end_links'] += 1
        else:
            log['split_end_unlinked'] += 1
    # 1c) 元のネットワークに届かなかった推定の組（どこにもつながらない 2 点だけのかたまり）は、役に立たないので取り消す
    for comp in _components(nodes, edges):
        if any(n['id'] in orig_net for n in comp): continue
        ids = {n['id'] for n in comp}
        before = len(edges)
        edges[:] = [e for e in edges if not (e.get('src') == 'derived-fix' and e['a'] in ids)]
        log['split_rolled_back_edges'] += before - len(edges)
        for n in comp:
            if n.get('netSrc') == 'derived-fix':
                n['networked'] = False; del n['netSrc']
                n['unlinkedReason'] = '上下の階の同じ設備とは重なるが、どちらの端も同じ階の 10 m 以内に通路の点がない'
    # 2) かたまりの切れ目：小さいかたまりと最大のかたまりが同じ階で 5 m 以内なら、いちばん近い点どうしを結ぶ
    comps = _components(nodes, edges)
    main = comps[0]
    for comp in comps[1:]:
        best = None
        for a in comp:
            for b in main:
                if a['level'] != b['level']: continue
                d = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
                if best is None or d < best[0]: best = (d, a, b)
        if best and best[0] <= BRIDGE_M:
            add(best[1], best[2], 'walk', 'かたまりの切れ目（%d 点のかたまりと最大のかたまりが %s で %.2f m）。元データの辺の抜けと推定'
                % (len(comp), best[1]['level'], best[0]))
            log['component_bridges'] += 1
            main = main + comp
    # 3) トイレ：元のネットワークにないトイレを、同じ階の 10 m 以内のいちばん近い点に結ぶ（ホームの中の点とは結ばない）
    net = [n for n in nodes if n.get('networked', True) and n['kind'] != 'exit']
    for t in [n for n in nodes if n['kind'] == 'toilet' and n.get('networked') is False]:
        cands = [n for n in net if n['level'] == t['level'] and n is not t and n['kind'] != 'toilet' and not in_plat(n)]
        b = min(cands, key=lambda n: (n['x'] - t['x']) ** 2 + (n['y'] - t['y']) ** 2, default=None)
        if b and math.hypot(b['x'] - t['x'], b['y'] - t['y']) <= TOILET_M:
            d = add(t, b, 'walk', 'トイレの入口が分からないため、同じ階のいちばん近い通路の点（%.1f m）に直線で結んだ' % math.hypot(b['x'] - t['x'], b['y'] - t['y']))
            log['toilet_links'] += 1
        else:
            t['unlinkedReason'] = '同じ階の 10 m 以内に通路の点がない（%s）' % ('最寄り %.1f m' % math.hypot(b['x'] - t['x'], b['y'] - t['y']) if b else '同じ階に点なし')
            log['toilet_unlinked'] += 1
    # 4) ホーム：多角形の中の、いま接続のある階段・エスカレーター・エレベーターを access に（推測ぶんは accessGuess に分ける）
    for P in platforms:
        ar = amap[P['area']]
        inn = [n for n in nodes if n['level'] == P['level'] and n['kind'] in ('stairs', 'escalator', 'elevator')
               and n.get('netSrc') == 'derived-fix' and inside((n['x'], n['y']), ar['poly'])]
        if inn:
            P['accessGuess'] = [n['id'] for n in inn]
            P['accessGuessNote'] = '同じ設備が上下の階で重なることから推定してつないだ点。元データにはホームの中の歩行ネットワークがなく、ホームの上をどう歩けるかも不明'
    comps = _components(nodes, edges)
    return {'sizes': [len(c) for c in comps],
            'platforms_with_access': sum(1 for P in platforms if P['access']),
            'platforms_with_accessGuess': sum(1 for P in platforms if P.get('accessGuess')),
            'toilets_linked': sum(1 for n in nodes if n['kind'] == 'toilet' and n.get('networked', True))}

LEVEL_ORDER = []

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tmg', required=True); ap.add_argument('--mlit', required=True)
    ap.add_argument('--osm'); ap.add_argument('--out', required=True); ap.add_argument('--stats', required=True)
    ap.add_argument('--xcheck', help='東京都と国交省の突き合わせ結果の CSV の出力先')
    a = ap.parse_args()
    import shapefile

    cm = json.load(open(os.path.join(a.tmg, 'com-map.geojson')))
    lv_by_id = {}; levels = []
    for L in cm['drawings'][0]['levels']:
        nm = L['properties']['name']; z = L['properties']['zlevel']
        lv_by_id[L['id']] = nm
        levels.append({'id': nm, 'name': nm, 'z': z * LEVEL_H, 'order': z,
                       'conf': {'order': '推', 'z': '不明'},
                       'note': '階の名前と上下の順序は出典どおり。z（高さ）は順序×5 m の仮置きで、実際の高さは不明。床は水平として扱う。'})
    levels.sort(key=lambda L: L['order'])
    LEVEL_ORDER[:] = [L['id'] for L in levels]

    F = {}
    for f in glob.glob(os.path.join(a.tmg, 'geojson-level-geom-*.geojson')):
        lv = os.path.basename(f)[len('geojson-level-geom-'):-len('.geojson')]
        for x in json.load(open(f))['features']:
            F[x['id']] = (lv, x)
    ent = json.load(open(os.path.join(a.tmg, 'com-entity.geojson')))['entities']
    ent_by_geom = C.defaultdict(list)
    for e in ent:
        for g in e['properties'].get('geometry', []):
            ent_by_geom[g[0]].append(e['properties'].get('name'))

    def cat(p):
        return p.get('facility') or p.get('barrier') or p.get('area') or p.get('service')

    def jname(gid):
        if gid not in F: return None
        names = [n for n in ent_by_geom.get(gid, []) if n]
        return names[0] if names else F[gid][1]['properties'].get('display_name')

    nav = json.load(open(os.path.join(a.tmg, 'v5_nav.json')))
    nodes = []; nid = {}; used_geom = set()
    for n in nav['n']:
        L = n['l'][0]; gid = L.get('gid'); lv = lv_by_id[L['lid']]
        p = F[gid][1]['properties'] if gid in F else {}
        k = KIND.get(cat(p), 'walk')
        lon, lat = px2ll(n['mx'], n['my']); x, y = xy(lon, lat)
        node = {'id': 'T%d' % n['id'], 'level': lv, 'x': x, 'y': y, 'kind': k,
                'src': TMG_SRC, 'srcId': n['id'], 'conf': '推'}
        if gid in F: node['srcGeom'] = gid
        nm = jname(gid) if k in ('gate', 'platform', 'toilet', 'elevator') else None
        if nm: node['name'] = nm
        if k == 'escalator' and p.get('to'): node['to'] = p['to']
        nodes.append(node); nid[n['id']] = node
        if gid: used_geom.add(gid)

    # ネットワークに載っていない施設（主にトイレの一部）は、つながりなしの点として置く
    for gid, (lv, x) in F.items():
        p = x['properties']; k = KIND.get(cat(p))
        if k not in ('toilet', 'elevator', 'escalator', 'stairs', 'gate') or gid in used_geom: continue
        lon, lat = centroid(x['geometry']); px, py = xy(lon, lat)
        node = {'id': 'TG%d' % gid, 'level': lv, 'x': px, 'y': py, 'kind': k, 'src': TMG_SRC, 'srcId': gid,
                'conf': '推', 'networked': False}
        nm = jname(gid)
        if nm and k in ('toilet', 'gate', 'elevator'): node['name'] = nm
        if p.get('gender'): node['gender'] = p['gender']
        nodes.append(node)

    edges = []; fixlog = C.Counter()
    for l in nav['l']:
        A, B = nid[l['n1']], nid[l['n2']]
        if A is B:   # 出典に両端が同じ点の辺（長さ 0）がある。経路の意味がないので落とす
            fixlog['self_loop_dropped'] += 1; continue
        if A['level'] != B['level']:
            ks = {A['kind'], B['kind']}
            k = next((t for t in ('elevator', 'escalator', 'stairs', 'ramp', 'step') if t in ks), 'vertical')
        else:
            k = A['kind'] if A['kind'] == B['kind'] and A['kind'] in ('stairs', 'escalator', 'movingwalk') else 'walk'
        e = {'a': A['id'], 'b': B['id'], 'm': round(l['dm'], 2), 'sec': round(l['dm'] / WALK, 1), 'kind': k,
             'src': TMG_SRC, 'conf': '推'}
        if l['d'] != 3: e['oneway'] = 'a>b' if l['d'] == 1 else 'b>a'
        if k in ('stairs', 'escalator') and A['level'] == B['level']:
            e['sameLevel'] = True   # 階段の点どうしの同じ階の辺（踊り場・階の中の短い段差など）。上下移動ではない
            e['note'] = '両端が同じ階の階段の点。階をまたぐ移動ではなく、同じ階の中の段差か踊り場と見られる（未確認）'
            fixlog['same_level_stair_edges'] += 1
        edges.append(e)

    # 出口：国交省データの F108「出口」代表点。TMG 側に地上出口の点がないため補う
    MLIT_LV = {'0': '1F', '1': '1F', 'B1': 'B1F', 'B2': 'B2F', 'B3': 'B3F', '2': '2F', '3': '3F', '4': '4F'}
    mlit_counts = C.Counter(); exits = []
    for f in glob.glob(os.path.join(a.mlit, 'ShinjukuTerminal', '*_Facility.shp')):
        tag = os.path.basename(f)[len('ShinjukuTerminal_'):-len('_Facility.shp')]
        r = shapefile.Reader(f[:-4], encoding='utf-8')
        for sr in r.shapeRecords():
            c = sr.record['category']; mlit_counts[c] += 1
            if c != 'F108': continue
            lon, lat = sr.shape.points[0]; px, py = xy(lon, lat)
            lv = MLIT_LV.get(tag.replace('out', ''))
            nm = (sr.record['name'] or '').strip()
            node = {'id': 'MX%s' % sr.record['id'][:10], 'level': lv, 'x': px, 'y': py, 'kind': 'exit',
                    'src': 'mlit', 'srcId': sr.record['id'], 'conf': '推', 'mlitFloor': tag,
                    'ground': tag in ('0', '1')}
            if nm: node['name'] = '出口 ' + nm
            node['note'] = '番号の振り方（どの事業者・どの地下街の番号か）は資料に書かれておらず不明'
            exits.append(node)
    # 一番近い同じ階の TMG の点に 25 m 以内ならつなぐ（推：近さだけで決めた接続）
    by_lv = C.defaultdict(list)
    for n in nodes:
        if n.get('networked', True): by_lv[n['level']].append(n)
    linked = 0
    for ex in exits:
        best = min(by_lv.get(ex['level'], []), key=lambda n: (n['x'] - ex['x']) ** 2 + (n['y'] - ex['y']) ** 2, default=None)
        if best:
            d = math.hypot(best['x'] - ex['x'], best['y'] - ex['y'])
            if d <= 25:
                edges.append({'a': ex['id'], 'b': best['id'], 'm': round(d, 2), 'sec': round(d / WALK, 1), 'kind': 'walk',
                              'src': 'derived', 'conf': '推', 'note': '最寄りの点に直線でつないだだけ。実際の通路は未確認'})
                linked += 1; continue
        ex['networked'] = False
    nodes += exits

    # 面：ホーム（area=section）と通路（hallway）を多角形で
    areas = []; platforms = []
    for gid, (lv, x) in F.items():
        p = x['properties']; c = cat(p)
        if c not in ('section', 'hallway'): continue
        rg = ring(x['geometry'])
        if not rg: continue
        xs = [q[0] for q in rg]; ys = [q[1] for q in rg]
        ar = {'id': 'A%d' % gid, 'level': lv, 'kind': 'platform' if c == 'section' else 'concourse',
              'rect': [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)],
              'poly': [[round(q[0], 1), round(q[1], 1)] for q in rg], 'src': TMG_SRC, 'conf': '推'}
        if c == 'section':
            nm = jname(gid) or p.get('display_name')
            ar['name'] = nm
            if not nm: ar['conf'] = '推'; ar['nameConf'] = '不明'
            platforms.append({'id': 'P%d' % gid, 'name': nm, 'line': nm, 'nameConf': '推' if nm else '不明', 'level': lv, 'area': ar['id'],
                              'axis': None, 'center': None, 's0': None, 's1': None,
                              'cars': None, 'carLen': None, 'doors': None, 'car1Front': None, 'dir': None,
                              'access': [], 'src': TMG_SRC, 'conf': '推',
                              'unknown': ['号車', 'ドア位置', '編成の長さ', 'ホームの向き（多角形だけあり）']})
        areas.append(ar)
    # ホームの多角形の中にある platform 種の点を access に入れる
    def inside(pt, poly):
        x, y = pt; c = False
        for i in range(len(poly)):
            x1, y1 = poly[i]; x2, y2 = poly[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: c = not c
        return c
    amap = {ar['id']: ar for ar in areas}
    for P in platforms:
        ar = amap[P['area']]
        P['access'] = [n['id'] for n in nodes if n['level'] == P['level'] and n.get('networked', True)
                       and n['kind'] in ('stairs', 'escalator', 'elevator', 'platform') and inside((n['x'], n['y']), ar['poly'])]

    xrows, xsum = crosscheck(a.mlit, F, cat, nodes, shapefile)
    fixes = fix_network(nodes, edges, platforms, amap, inside, fixlog)

    model = {
        'format': 'gyrotraffic-station-v0',
        '_draft': '新宿駅の下書き。公的なオープンデータ（東京都・国土交通省）を機械的に変換しただけで、現地確認はしていない。'
                  '「確」は現地か事業者で確かめたものだけに付ける決まりで、いまは 0 件。',
        'id': 'SHINJUKU_DRAFT', 'name': '新宿駅（下書き）',
        'units': {'length': 'm', 'time': 's'},
        'origin': {'lat': LAT0, 'lon': LON0, 'axes': 'x=東 y=北（m）。原点は任意に置いた点'},
        'assumptions': {'walkMps': WALK, 'levelHeight': LEVEL_H,
                        'note': '秒数は出典の距離 ÷ 1.2 m/s の仮の値。階段・エスカレーター・エレベーターの所要時間も同じ式で、実際とは違う。階の高さは不明のため 5 m 刻みの仮置き。'},
        'confidenceScale': {'確': '現地または事業者の確認あり', '推': '公的データにあるが現地未確認（データは調査時点のもの）', '不明': '資料なし'},
        'sources': {
            'tmg': {'text': '東京都「新宿駅の施設情報及び施設から目的地への移動ルート情報」（屋内測位新宿ターミナル オープンデータ、仕様書 令和5年2月改訂版）を加工して作成',
                    'license': 'CC BY 4.0', 'url': 'https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000037'},
            'mlit': {'text': '「新宿駅周辺屋内地図データ」（国土交通省）（https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2）を加工して作成。出典：国土交通省 高精度測位社会プロジェクト',
                     'license': '政府標準利用規約 2.0（CC BY 4.0 互換）', 'url': 'https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2'},
            'derived': {'text': 'このリポジトリで機械的に作った接続（出口→最寄りの点）'},
            'derived-fix': {'text': 'このリポジトリで足した推測の接続（切れ目の橋・トイレ・エレベーターの同じ昇降路）。すべて「推」、guess:true、理由と距離つき'},
        },
        'levels': [{k: v for k, v in L.items() if k != 'order'} for L in levels],
        'areas': areas, 'tracks': [], 'platforms': platforms, 'nodes': nodes, 'edges': edges,
        'targets': [P['id'] for P in platforms] + [n['id'] for n in exits if n.get('ground') and n.get('networked', True)],
        'evidenceScale': {'複数出典で一致': '東京都と国交省の両方に、同じ階・同じ種類・5 m 以内で載っている。現地確認ではないので conf は「推」のまま'},
        'unknown': ['線路の位置（tracks は空）', '号車・ドア位置', '実際の階の高さ', '出口番号の体系', '現在の状態（データは 2020〜2023 年の調査時点）'],
    }
    json.dump(model, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))

    st = {'tmg_nodes_by_kind': C.Counter(n['kind'] for n in nodes if n['src'] == TMG_SRC),
          'tmg_networked_by_kind': C.Counter(n['kind'] for n in nodes if n['src'] == TMG_SRC and n.get('networked', True)),
          'edges_by_kind': C.Counter(e['kind'] for e in edges), 'exits': len(exits),
          'exits_ground': sum(1 for e in exits if e['ground']), 'exits_linked': linked,
          'platform_areas': len(platforms), 'hallway_areas': sum(1 for x in areas if x['kind'] == 'concourse'),
          'tmg_geom_counts': C.Counter(cat(x['properties']) for _, x in F.values()),
          'tmg_toilet_names': C.Counter(F[g][1]['properties'].get('display_name') for g in F if cat(F[g][1]['properties']) in ('bathroom', 'universalaccesstoilet')),
          'gates': sorted({n.get('name') or '?' for n in nodes if n['kind'] == 'gate'}),
          'platform_names': sorted(P['name'] or '?' for P in platforms),
          'mlit_facility_counts': mlit_counts,
          'crosscheck': xsum, 'network_fixes': dict(fixlog), 'components_after': fixes}
    if a.xcheck:
        import csv
        with open(a.xcheck, 'w', newline='') as fh:
            w = csv.writer(fh); w.writerow(['result', 'kind', 'tmg_level', 'mlit_level', 'd_m', 'tmg_geom', 'mlit_id', 'x', 'y', 'note'])
            for r in xrows: w.writerow(r)
    r = shapefile.Reader(os.path.join(a.mlit, 'nw', 'Shinjuku_link'), encoding='utf-8')
    st['mlit_nw_links'] = len(r); st['mlit_nw_route_type'] = C.Counter(x['route_type'] for x in r.records())
    st['mlit_nw_nodes'] = len(shapefile.Reader(os.path.join(a.mlit, 'nw', 'Shinjuku_node'), encoding='utf-8'))
    if a.osm:
        E = json.load(open(a.osm))['elements']; t = lambda e: e.get('tags', {})
        st['osm'] = {'elements': len(E),
                     'toilets': sum(1 for e in E if t(e).get('amenity') == 'toilets'),
                     'steps': sum(1 for e in E if t(e).get('highway') == 'steps' and 'conveying' not in t(e)),
                     'escalator(conveying)': sum(1 for e in E if 'conveying' in t(e)),
                     'elevator': sum(1 for e in E if t(e).get('highway') == 'elevator'),
                     'subway_entrance': sum(1 for e in E if t(e).get('railway') == 'subway_entrance'),
                     'entrance=*': sum(1 for e in E if 'entrance' in t(e)),
                     'railway=platform': sum(1 for e in E if t(e).get('railway') == 'platform'),
                     'indoor=*': sum(1 for e in E if 'indoor' in t(e)),
                     'timestamp': json.load(open(a.osm)).get('osm3s', {}).get('timestamp_osm_base')}
    json.dump(st, open(a.stats, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
