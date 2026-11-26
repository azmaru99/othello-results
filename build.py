#!/usr/bin/env python3
"""
日本オセロ連盟レーティングの大会ページから、サイト用のデータを作る。

  python3 tools/build.py            # 足りない大会だけ取得して data/ を作り直す
  python3 tools/build.py --refetch  # 全大会を取り直す

- 対象の大会は tools/tournaments.tsv（ID・日付・棋戦・大会名）に1行ずつ書く
- 取得したページは tools/cache/ に保存し、2回目からはそれを使う
- 出力：results.json（大会一覧と全大会の結果を1つにまとめたもの）
"""
import html
import json
import os
import re
import subprocess
import sys
import time
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
CACHE = os.path.join(TOOLS, 'cache')
SRC = 'https://www.othello.gr.jp/rate/rate_tournaments/'

KANJI = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
# 番号が大会名に無い大会
EDITION_FIX = {'2006-08-26': 1, '2012-03-03': 33, '2012-03-04': 33}


def fetch(tid, refetch):
    path = os.path.join(CACHE, f'{tid}.html')
    if refetch or not os.path.exists(path) or os.path.getsize(path) == 0:
        r = subprocess.run(['curl', '-sfL', '-A', 'Mozilla/5.0', SRC + tid], capture_output=True)
        if r.returncode != 0:
            raise SystemExit(f'取得できませんでした: {SRC}{tid}')
        with open(path, 'wb') as f:
            f.write(r.stdout)
        time.sleep(0.5)  # 連盟のサーバーに負担をかけない
    with open(path, encoding='utf8', errors='replace') as f:
        return f.read()


def text(cell):
    return html.unescape(re.sub(r'<[^>]+>', '', cell)).strip()


def edition(name, date):
    if date in EDITION_FIX:
        return EDITION_FIX[date]
    n = unicodedata.normalize('NFKC', name)
    m = re.search(r'第\s*(\d+)\s*[期回]', n)
    if m:
        return int(m.group(1))
    m = re.search(r'第([一二三四五六七八九十]+)[期回]', n)
    if m:
        k = m.group(1)
        return KANJI[k] if len(k) == 1 else 10 + KANJI.get(k[-1], 0)
    raise SystemExit(f'回数がわかりません: {name}（EDITION_FIX に追加してください）')


def division(name, event):
    n = unicodedata.normalize('NFKC', name)
    women = '女流' in n
    # 棋戦名までを削って、残りを部門名にする
    n = re.sub(r'^.*?(名人戦(全国大会)?|選手権(大会)?|王座戦)', '', n)
    n = re.sub(r'[【】「」\-−]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    if event == '王座戦' and n.startswith('女流'):
        women = False  # 「女流王座決定戦」はそのまま
    if women and '女' not in n:
        n = ('女子の部 ' + n).strip()
    return n or '本戦'


def parse(page):
    m = re.search(r'<table class="table tournament_show_table[^"]*">(.*?)</table>', page, re.S)
    if not m:
        raise ValueError('表が見つかりません')
    trs = re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(1), re.S)
    head = [text(c) for c in re.findall(r'<th[^>]*>(.*?)</th>', trs[0], re.S)]
    nrounds = sum(1 for h in head if h.endswith('回戦'))
    body = trs[1:]
    players = []
    for a, b in zip(body[0::2], body[1::2]):
        ca = re.findall(r'<td[^>]*>(.*?)</td>', a, re.S)
        cb = [text(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', b, re.S)]
        pid = re.search(r'rate_players/(\d+)', ca[1])
        rate = re.match(r'(\d+)→(\d+)', text(ca[-1]))
        games = []
        for r in range(nrounds):
            cell = text(ca[3 + r])
            g = re.match(r'([○×△])\s*(-?\d+)', cell)
            games.append([g.group(1), int(g.group(2)), cb[3 + r]] if g else None)
        players.append({
            'rank': int(text(ca[0])) if text(ca[0]).isdigit() else None,
            'name': text(ca[1]),
            'abbr': text(ca[2]),
            'region': cb[1],
            'dan': cb[2],
            'pid': int(pid.group(1)) if pid else None,
            'rate': [int(rate.group(1)), int(rate.group(2))] if rate else None,
            'games': games,
        })
    return nrounds, players


def build(refetch=False):
    os.makedirs(CACHE, exist_ok=True)
    rows = []
    with open(os.path.join(TOOLS, 'tournaments.tsv'), encoding='utf8') as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                rows.append(line.rstrip('\n').split('\t'))
    index = []
    alldata = {}
    for tid, date, event, name in rows:
        name = html.unescape(name).strip()
        nrounds, players = parse(fetch(tid, refetch))
        # 対戦相手の省略名を、同じ大会の選手番号に置きかえる
        by_abbr = {}
        for i, p in enumerate(players):
            by_abbr.setdefault(p['abbr'], []).append(i)
        unresolved = 0
        for p in players:
            for g in p['games']:
                if g:
                    hit = by_abbr.get(g[2], [])
                    if len(hit) == 1:
                        g[2] = hit[0]
                    else:
                        unresolved += 1
        # 石数が「勝ち64・負け0」だけ、または0ばかりの大会は石数なしとみなす
        stones = [g[1] for p in players for g in p['games'] if g]
        real = [s for s in stones if s not in (0, 64)]
        has_stones = bool(stones) and len(real) / len(stones) > 0.5
        if not has_stones:
            for p in players:
                for g in p['games']:
                    if g:
                        g[1] = None
        wins = lambda p: sum(1 for g in p['games'] if g and g[0] == '○') + 0.5 * sum(1 for g in p['games'] if g and g[0] == '△')
        data = {
            'id': int(tid), 'date': date, 'event': event, 'name': name,
            'edition': edition(name, date), 'division': division(name, event),
            'rounds': nrounds, 'hasStones': has_stones,
            'players': [[p['rank'], p['name'], p['abbr'], p['region'], p['dan'], p['pid'], p['rate'],
                         [g if g else 0 for g in p['games']]] for p in players],
        }
        alldata[tid] = data
        top = players[0] if players else None
        index.append({
            'id': int(tid), 'date': date, 'event': event, 'name': name,
            'edition': data['edition'], 'division': data['division'],
            'count': len(players), 'rounds': nrounds,
            'winner': top['name'] if top else '',
            'winnerWins': wins(top) if top else 0,
        })
        if unresolved:
            print(f'  {tid} {name}: 相手がわからない対局 {unresolved}件')
    index.sort(key=lambda t: (t['date'], t['id']), reverse=True)
    with open(os.path.join(ROOT, 'results.json'), 'w', encoding='utf8') as f:
        json.dump({'index': index, 't': alldata}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(index)}大会を書き出しました')


if __name__ == '__main__':
    build('--refetch' in sys.argv)
