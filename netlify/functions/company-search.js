// Netlify Serverless Function: 企業情報検索
// Wikipedia日本語版APIから企業の実際の情報を取得し、志望動機に使える特徴を抽出する
//
// 本番環境への移植:
//   このファイルの handler 関数の中身をそのままExpressやAWS Lambda等に移植可能です。
//   fetchの部分はNode.js 18+のネイティブfetch、または node-fetch で動作します。

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const name = (event.queryStringParameters || {}).name || '';
  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '企業名が指定されていません' }) };
  }

  try {
    // Step 1: Wikipedia検索で最も関連性の高い記事を見つける
    const searchUrl = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch='
      + encodeURIComponent(name + ' 企業 建設')
      + '&srlimit=3&format=json&utf8=1';

    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'KentenResumeBuilder/1.0 (construction resume tool)' }
    });
    const searchData = await searchRes.json();
    const results = (searchData.query && searchData.query.search) || [];

    if (results.length === 0) {
      // Wikipedia にない場合: Google検索のスニペット的なものは取れないので、
      // 企業名から推定できる情報だけ返す
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ found: false, name: name, trait: null, strength: null, summary: null })
      };
    }

    // Step 2: 最も関連性の高い記事の本文を取得
    const title = results[0].title;
    const contentUrl = 'https://ja.wikipedia.org/w/api.php?action=query&titles='
      + encodeURIComponent(title)
      + '&prop=extracts&exintro=1&explaintext=1&exsectionformat=plain&format=json&utf8=1';

    const contentRes = await fetch(contentUrl, {
      headers: { 'User-Agent': 'KentenResumeBuilder/1.0 (construction resume tool)' }
    });
    const contentData = await contentRes.json();
    const pages = contentData.query && contentData.query.pages;
    let extract = '';
    if (pages) {
      const pageId = Object.keys(pages)[0];
      extract = (pages[pageId] && pages[pageId].extract) || '';
    }

    if (!extract) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ found: false, name: name, title: title, trait: null, strength: null, summary: null })
      };
    }

    // Step 3: 抽出したテキストから企業の特徴を要約
    // イントロ部分（冒頭500文字程度）から有用な情報を抽出
    const intro = extract.substring(0, 1500);

    // 事業内容・特徴のキーワードを抽出
    const traits = extractTraits(intro, name, title);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        found: true,
        name: name,
        title: title,
        trait: traits.trait,
        strength: traits.strength,
        summary: intro.substring(0, 300),
        source: 'wikipedia'
      })
    };

  } catch (err) {
    console.error('Company search error:', err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'サーバーエラーが発生しました', detail: err.message })
    };
  }
};

/**
 * Wikipedia本文から企業の特徴・強みを抽出する
 * trait: 志望動機の「〜に強く惹かれ」に入る企業の魅力フレーズ
 * strength: 締め文の「貴社の〜に貢献」に入る強みフレーズ
 */
function extractTraits(text, inputName, wikiTitle) {
  var sentences = text.split(/。/).filter(function(s) { return s.trim().length > 5; });
  var trait = '';
  var strength = '';

  // === trait抽出: 企業の魅力・特徴 ===

  // 1. 第1文から「〇〇は、△△」の△△を取得（企業の基本説明）
  var firstDesc = '';
  if (sentences.length > 0) {
    var m = sentences[0].match(/(?:は、|は)[^\n]+$/);
    if (m) {
      firstDesc = m[0].replace(/^(?:は、|は)\s*/, '').replace(/である$/, '').trim();
    }
  }

  // 2. 特徴的なフレーズを全文から探す（優先度順）
  var traitPatterns = [
    // 「〜で知られる」「〜で定評」系
    /([^\n。]{5,60}(?:で知られ|で定評|に定評|で有名|として知られ))/,
    // 「日本最大」「業界トップ」系
    /((?:日本|国内|世界|業界)[^\n。]{2,20}(?:最大|トップ|首位|No\.?1|有数|屈指)[^\n。]{0,30})/,
    // 「スーパーゼネコン」等の業界ポジション
    /(スーパーゼネコン[^\n。]{0,30})/,
    /((?:大手|準大手|中堅|老舗|最大手)[^\n。]{5,50})/,
    // 「〜を手がける」系
    /([^\n。]{5,40}(?:を手がけ|を展開|に注力|を主力|を誇))/,
  ];
  for (var i = 0; i < traitPatterns.length; i++) {
    var tm = text.match(traitPatterns[i]);
    if (tm && tm[1] && tm[1].length > 5) {
      trait = tm[1].trim();
      break;
    }
  }

  // 3. traitがまだ空 → 第2文以降から事業内容を拾う
  if (!trait && sentences.length > 1) {
    for (var si = 1; si < Math.min(sentences.length, 4); si++) {
      var s = sentences[si].trim();
      if (s.length > 10 && s.length < 100 && !/本社|設立|創業|年|月|日|所在/.test(s.substring(0, 10))) {
        trait = s;
        break;
      }
    }
  }

  // 4. それでも空 → firstDescを使う（ただし所在地だけの場合は除外）
  if (!trait && firstDesc && !/^[^\n]{0,5}(?:に本社|を置く|所在)/.test(firstDesc)) {
    trait = firstDesc;
  }

  // traitクリーンアップ
  trait = trait.replace(/^[、。し]+/, '').replace(/^[をにがはでの]\s*/, '').trim();
  // 企業名・「株式会社」が冒頭に残っている場合は除去
  trait = trait.replace(/^.*?株式会社[はがの、]*/, '').trim();
  if (inputName) {
    var cleanName = inputName.replace(/株式会社|（株）|\(株\)/g, '').trim();
    trait = trait.replace(new RegExp('^' + cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[はがの、]*'), '').trim();
  }
  // 「〜を手がけ」→「〜を手がける実績」等、自然な終止形に
  trait = trait.replace(/を手がけ$/, 'を手がける実績');
  trait = trait.replace(/を主力$/, 'を主力とする事業展開');
  trait = trait.replace(/で知られ$/, 'で知られる実績');
  trait = trait.replace(/で知られる$/, 'で知られる実績');
  trait = trait.replace(/でも知られる$/, 'でも知られる実績');
  trait = trait.replace(/を展開$/, 'を展開する事業力');
  trait = trait.replace(/に注力$/, 'に注力する姿勢');
  trait = trait.replace(/を誇$/, 'を誇る実績');
  trait = trait.replace(/である$/, '');
  trait = trait.replace(/で定評$/, 'で定評がある実績');
  trait = trait.replace(/に定評$/, 'に定評がある実績');
  trait = trait.replace(/を行う$/, 'を行う事業力');
  trait = trait.replace(/を行っている$/, 'を行っている実績');
  trait = trait.replace(/を担い[、,].*$/, 'を担う事業力');
  // 「知られるに」→「知られる実績に」を防ぐための末尾調整
  trait = trait.replace(/る$(?!実績|姿勢|事業|事業力)/, 'る実績');
  // 括弧で終わっている場合の処理
  trait = trait.replace(/[）\)]$/, '').replace(/[（\(][^）\)]*$/, '').trim();

  // === strength抽出: 貴社の〇〇に貢献 に入るフレーズ ===
  var strengthKW = [
    { re: /スーパーゼネコン|総合建設/, s: '総合建設業としての圧倒的な技術力と施工実績' },
    { re: /設計.*施工|設計施工一貫/, s: '設計施工一貫体制による高い品質管理' },
    { re: /マンション|集合住宅/, s: 'マンション・集合住宅建設における専門ノウハウ' },
    { re: /超高層|高層/, s: '超高層建築における先進的な施工技術' },
    { re: /免震|耐震|制震/, s: '耐震・免震技術における先進性' },
    { re: /環境|グリーン|省エネ|ZEB|ZEH/, s: '環境配慮型建築への先進的な取り組み' },
    { re: /海外|グローバル|国際/, s: 'グローバルな事業展開力' },
    { re: /再開発|都市開発|まちづくり|街づくり/, s: '都市再開発における豊富なプロジェクト実績' },
    { re: /橋梁|橋|トンネル|ダム/, s: '大型インフラにおける高度な施工技術' },
    { re: /電気|電設|電工/, s: '電気設備工事における専門的な技術力' },
    { re: /空調|冷熱|衛生|設備工事/, s: '建築設備工事における総合的な技術力' },
    { re: /住宅|住まい|戸建|注文住宅/, s: '住宅建設における設計力と顧客対応力' },
    { re: /リフォーム|リノベ|改修/, s: 'リフォーム・改修工事における提案力と施工品質' },
    { re: /道路|舗装/, s: '道路・舗装工事における確かな施工力' },
    { re: /土木/, s: '土木工事における確かな施工管理力' },
    { re: /不動産|開発|デベロッパー/, s: '不動産開発における企画力と事業推進力' },
    { re: /DX|ICT|BIM|デジタル/, s: '建設DXにおける先進的な取り組み' },
    { re: /塗装|防水/, s: '仕上工事における専門技術と品質管理' },
    { re: /鉄骨|鋼構造|鉄工/, s: '鉄骨・鋼構造物における高い施工技術' },
    { re: /プラント|工場/, s: 'プラント建設における専門的な施工管理力' },
    { re: /木造|木材/, s: '木造建築における専門技術' },
    { re: /測量/, s: '測量技術における専門力' },
    { re: /設計事務所|組織設計/, s: '建築設計における創造力と技術力' },
    { re: /建設|施工|工事/, s: '建設事業における確かな技術力と施工実績' },
  ];
  for (var j = 0; j < strengthKW.length; j++) {
    if (strengthKW[j].re.test(text)) {
      strength = strengthKW[j].s;
      break;
    }
  }
  // strengthフォールバック: firstDescから簡潔に
  if (!strength && firstDesc) {
    strength = firstDesc.length > 50 ? firstDesc.substring(0, 47) + '…' : firstDesc;
  }

  // 長さ制限
  if (trait.length > 100) trait = trait.substring(0, 97) + '…';
  if (strength.length > 80) strength = strength.substring(0, 77) + '…';

  return { trait: trait, strength: strength };
}
