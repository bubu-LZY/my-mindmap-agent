(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var success = style.getPropertyValue('--success').trim();
  var warning = style.getPropertyValue('--warning').trim();
  var danger = style.getPropertyValue('--danger').trim();

  // --- Chart 1: VRAM Comparison ---
  var chartVram = echarts.init(document.getElementById('chart-vram'), null, { renderer: 'svg' });
  chartVram.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      axisPointer: { type: 'shadow' },
      formatter: function(params) {
        return params[0].name + '<br/>最低显存需求：<strong>' + params[0].value + ' GB</strong>';
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: ['MiniCPM-V 2.6', 'Qwen2.5-VL-7B', 'InternVL3.5-8B', 'CogVLM2-19B', 'Qwen2.5-VL-72B', 'InternVL3.5-38B', 'GLM-4.5V'],
      axisLabel: {
        color: muted,
        fontSize: 12,
        interval: 0,
        rotate: 20
      },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '显存 (GB)',
      nameTextStyle: { color: muted, fontSize: 12 },
      axisLabel: { color: muted, fontSize: 12 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: [
        { value: 7, itemStyle: { color: success } },
        { value: 9, itemStyle: { color: success } },
        { value: 10, itemStyle: { color: warning } },
        { value: 16, itemStyle: { color: warning } },
        { value: 40, itemStyle: { color: danger } },
        { value: 20, itemStyle: { color: danger } },
        { value: 400, itemStyle: { color: danger } }
      ],
      barWidth: '50%',
      itemStyle: {
        borderRadius: [4, 4, 0, 0]
      },
      label: {
        show: true,
        position: 'top',
        color: ink,
        fontSize: 12,
        fontWeight: 600,
        formatter: '{c} GB'
      }
    }]
  });
  window.addEventListener('resize', function() { chartVram.resize(); });

  // --- Chart 2: Hardware tiers ---
  var chartHardware = echarts.init(document.getElementById('chart-hardware'), null, { renderer: 'svg' });
  chartHardware.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: function(params) {
        return '<strong>' + params.name + '</strong><br/>' + params.data.desc;
      }
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: ink, fontSize: 13 },
      itemWidth: 14,
      itemHeight: 14
    },
    series: [{
      type: 'pie',
      radius: ['45%', '75%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 4,
        borderColor: bg2,
        borderWidth: 2
      },
      label: {
        show: true,
        position: 'outside',
        color: ink,
        fontSize: 12,
        formatter: '{b}\n{d}%'
      },
      labelLine: {
        lineStyle: { color: rule }
      },
      data: [
        {
          value: 40,
          name: '入门级 (<8GB)',
          itemStyle: { color: muted },
          desc: '仅云端API + MinerU CPU版'
        },
        {
          value: 35,
          name: '主流级 (8-12GB)',
          itemStyle: { color: success },
          desc: 'MiniCPM-V 2.6 + MinerU ★推荐'
        },
        {
          value: 18,
          name: '进阶级 (12-24GB)',
          itemStyle: { color: accent },
          desc: 'Qwen2.5-VL-7B + MinerU'
        },
        {
          value: 7,
          name: '专业级 (>24GB)',
          itemStyle: { color: accent2 },
          desc: 'Qwen2.5-VL-72B / InternVL3.5-38B'
        }
      ]
    }]
  });
  window.addEventListener('resize', function() { chartHardware.resize(); });
})();
