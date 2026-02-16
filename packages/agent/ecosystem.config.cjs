module.exports = {
  apps: [
    {
      name: 'bematic-agent',
      script: 'start-agent.sh',
      interpreter: 'bash',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/agent-error.log',
      out_file: './logs/agent-out.log',
      merge_logs: true,
    },
  ],
};
