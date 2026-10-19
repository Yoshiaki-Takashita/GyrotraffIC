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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tmg', required=True); ap.add_argument('--mlit', required=True)
    ap.add_argument('--osm'); ap.add_argument('--out', required=True); ap.add_argument('--stats', required=True)
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

    edges = []
    for l in nav['l']:
        A, B = nid[l['n1']], nid[l['n2']]
        if A['level'] != B['level']:
            ks = {A['kind'], B['kind']}
            k = next((t for t in ('elevator', 'escalator', 'stairs', 'ramp', 'step') if t in ks), 'vertical')
        else:
            k = A['kind'] if A['kind'] == B['kind'] and A['kind'] in ('stairs', 'escalator', 'movingwalk') else 'walk'
        e = {'a': A['id'], 'b': B['id'], 'm': round(l['dm'], 2), 'sec': round(l['dm'] / WALK, 1), 'kind': k,
             'src': TMG_SRC, 'conf': '推'}
        if l['d'] != 3: e['oneway'] = 'a>b' if l['d'] == 1 else 'b>a'
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
        },
        'levels': [{k: v for k, v in L.items() if k != 'order'} for L in levels],
        'areas': areas, 'tracks': [], 'platforms': platforms, 'nodes': nodes, 'edges': edges,
        'targets': [P['id'] for P in platforms] + [n['id'] for n in exits if n.get('ground') and n.get('networked', True)],
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
          'mlit_facility_counts': mlit_counts}
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
